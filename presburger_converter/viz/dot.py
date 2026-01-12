import re
from collections import defaultdict
from typing import List, Tuple
from collections import deque

from presburger_converter.automaton.automaton_builder import decode
from presburger_converter.pipeline import formula_to_aut

###############################################################################
# Helper utilities                                                             #
###############################################################################


def int_to_digitstring(i: int, width: int, base: int = 2) -> str:
    """
    Return *width*-digit base-N representation of *i*
    *little-endian* (LSD-first) so it matches the automaton's encoding.
    
    Args:
        i: Integer to convert
        width: Number of digits in output
        base: The base for encoding (default 2 for binary)
    
    Returns:
        String of digits in least-significant-first order
    """
    digits = []
    for _ in range(width):
        digits.append(str(i % base) if i % base < 10 else chr(ord('A') + i % base - 10))
        i //= base
    return ''.join(digits)


###############################################################################
# Wild-card compression utilities                                              #
###############################################################################


def _can_merge(a: str, b: str) -> str | None:
    """Return merged pattern if *a* and *b* differ by **exactly one** concrete digit.

    Both patterns must have equal length. The merge is only permitted when the
    differing position contains concrete digits (not ``*``) in both patterns.
    The result is the pattern with a ``*`` at that position.
    Otherwise ``None`` is returned.
    """
    if len(a) != len(b):
        return None

    diff_pos = -1
    for idx, (ca, cb) in enumerate(zip(a, b)):
        if ca == cb:
            continue
        # Abort if either side already has a wildcard here.
        if ca == "*" or cb == "*":
            return None
        # More than one differing digit? no merge.
        if diff_pos != -1:
            return None
        diff_pos = idx

    if diff_pos == -1:  # identical
        return None

    merged = list(a)
    merged[diff_pos] = "*"
    return "".join(merged)


def _compress_digit_patterns(patterns: List[str]) -> List[str]: # this is likely dead code
    """Iteratively merge patterns using the * wildcard.

    The algorithm keeps merging two patterns whenever they can be merged until
    no more merges are possible. The resulting list is returned *sorted* for
    determinism.
    """
    work: set[str] = set(patterns)

    merged_something = True
    while merged_something:
        merged_something = False
        items = list(work)
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                merged = _can_merge(items[i], items[j])
                if merged:
                    work.discard(items[i])
                    work.discard(items[j])
                    work.add(merged)
                    merged_something = True
                    break
            if merged_something:
                break

    return sorted(work)


def compress_label_string(label_str: str) -> str: # this is likely dead code
    """Compress a comma-separated list of digit-strings using wild-cards.

    Example::
        >>> compress_label_string("01,10,11")
        '01,1*'
    """
    labels = [lbl.strip() for lbl in label_str.split(",") if lbl.strip()]
    if not labels:
        return ""
    compressed = _compress_digit_patterns(labels)
    return ",".join(compressed)


###############################################################################
# DOT helper: reorder bit-labels after a variable permutation                  #
###############################################################################

def _reorder_digit_patterns_in_label(label: str,
                                   mapping: dict[int, int],
                                   width: int) -> str:
    """
    Reorder every digit-pattern inside *label* according to *mapping*.

    *label* is the raw string that appears inside `label="..."` – it can contain
    several comma-separated patterns that may include wild-cards (`*`).

    Any pattern that
        * has length *width*, **and**
        * consists only of alphanumeric digits and `*`
    is permuted; everything else (epsilon, 'ε', etc.) is left unchanged.
    """
    parts = [p.strip() for p in label.split(",") if p.strip()]
    new_parts: list[str] = []

    inv = {new_idx: old_idx for old_idx, new_idx in mapping.items()}

    for p in parts:
        if len(p) == width and all(c.isalnum() or c == '*' for c in p):
            reordered = [""] * width
            for new_idx in range(width):
                old_idx = inv[new_idx]
                reordered[new_idx] = p[old_idx]
            new_parts.append("".join(reordered))
        else:
            new_parts.append(p)            # untouched (epsilon, etc.)

    return ",".join(new_parts)


def reorder_digitstring_labels(dot: str,
                             mapping: dict[int, int],
                             width: int) -> str:
    """
    Apply the digit-position permutation encoded in *mapping* to **all** edge
    labels in *dot* and return the updated DOT string.
    """
    label_re = re.compile(r'(\[label=")([^"]*)("\])')

    def _repl(m: re.Match[str]) -> str:
        prefix, raw, suffix = m.groups()
        new_raw = _reorder_digit_patterns_in_label(raw, mapping, width)
        return f'{prefix}{new_raw}{suffix}'

    return label_re.sub(_repl, dot)


###############################################################################
# DOT manipulation                                                             #
###############################################################################

# Matches lines of the form "  2 -> { 3 } [label=\"0,1\"] ;"
_EDGE_LINE = re.compile(r"^(\s*)(\d+)\s*->\s*\{\s*(\d+)\s*\}\s*\[(.*)\];\s*$")
_LABEL_ATTR = re.compile(r'label\s*=\s*"([^"]*)"')


def convert_int_labels_to_digitstrings(dot: str, width: int, base: int = 2) -> str:
    """Replace integer edge labels with base-N digit strings of *width* digits.
    
    Args:
        dot: DOT string with integer labels
        width: Number of digits per label
        base: The base for encoding (default 2 for binary)
    
    Returns:
        DOT string with digit string labels
    """

    def _repl(match: re.Match[str]) -> str:
        raw = match.group(1)
        parts = [p.strip() for p in raw.split(",")]
        converted: list[str] = []
        for part in parts:
            if part.isdigit():
                converted.append(int_to_digitstring(int(part), width, base))
            else:  # already something else (epsilon, *, ...)
                converted.append(part)
        return f'label="{",".join(converted)}"'

    return _LABEL_ATTR.sub(_repl, dot)


def optimize_dot_start_arrow(dot_string: str) -> str:
    """
    Consolidate all  iX -> N  start arrows into a single point  i0.
    Works after your nodes have been renamed/decoded.
    """
    # ------------------------------------------------------------------
    # 1.  Find every  i<number> -> target  edge and collect the targets
    # ------------------------------------------------------------------
    # captures: i123   ->   -4   [label="..."];
    target_pat = re.compile(r'i\d+\s*->\s*([\-]?\d+)\s*(?:\[|;)')
    targets: List[str] = target_pat.findall(dot_string)

    if not targets:               # fallback
        targets = ['0']

    # ------------------------------------------------------------------
    # 2.  Strip *all* old invisible-node declarations and arrows
    # ------------------------------------------------------------------
    # a) helper line:  node [shape=none, label=""];
    dot_string = re.sub(
        r'\s*node\s*\[\s*shape\s*=\s*none\s*,\s*label\s*=\s*""\s*\]\s*;\s*',
        '',
        dot_string,
        flags=re.IGNORECASE,
    )

    # b) any  iX [shape=point ...];
    dot_string = re.sub(
        r'\s*i\d+\s*\[.*?shape\s*=\s*point.*?];\s*',
        '',
        dot_string,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # c) any  iX -> N   arrow (with or without attributes)
    dot_string = re.sub(
        r'\s*i\d+\s*->\s*[\-]?\d+\s*(?:\[.*?])?\s*;\s*',
        '',
        dot_string,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # ------------------------------------------------------------------
    # 3.  Build the new, consolidated start node block
    # ------------------------------------------------------------------
    start_block = [
        '    i0 [shape=point, width=0.01, height=0.01, style=invis];'
    ]
    for tgt in dict.fromkeys(targets):          # keep original order, no dups
        start_block.append(
            f'    i0 -> {tgt} [arrowhead=normal, style=solid, weight=0];'
        )
    start_block_str = "\n".join(start_block) + "\n"

    # ------------------------------------------------------------------
    # 4.  Insert the block right before the final “}”
    # ------------------------------------------------------------------
    dot_string = dot_string.rstrip()
    if dot_string.endswith('}'):
        dot_string = dot_string[:-1] + start_block_str + "}\n"
    else:                                       # should not happen, but be safe
        dot_string += "\n" + start_block_str

    return dot_string

###############################################################################
# New step 1: merge parallel edges                                             #
###############################################################################


def merge_parallel_edges(dot: str) -> str:
    """Combine parallel edges (same *src* ➜ *dst*) and concatenate their labels.

    The labels are **not** compressed here – we simply unify them into a single
    comma-separated list. Wild-card compression is handled in a later pass.
    """
    groups: dict[Tuple[str, str, str], List[str]] = defaultdict(list)
    header: List[str] = []
    footer: List[str] = []
    in_edges = False

    for line in dot.splitlines(keepends=True):
        m = _EDGE_LINE.match(line)
        if m:
            in_edges = True
            indent, src, dst, attrs = m.groups()
            lab_match = _LABEL_ATTR.search(attrs)
            if lab_match:
                labels = [l.strip() for l in lab_match.group(1).split(",") if l.strip()]
            else:
                labels = []
            groups[(indent, src, dst)].extend(labels)
        else:
            # Decide whether we are before or after the edge section.
            (header if not in_edges else footer).append(line)

    merged_edge_lines: List[str] = []
    for (indent, src, dst), labels in groups.items():
        # Keep original order but remove duplicates.
        seen: set[str] = set()
        uniq_labels = []
        for lbl in labels:
            if lbl not in seen:
                seen.add(lbl)
                uniq_labels.append(lbl)
        label_str = ",".join(uniq_labels)
        merged_edge_lines.append(
            f"{indent}{src} -> {{ {dst} }} [label=\"{label_str}\"]\n"
        )

    return "".join(header) + "".join(merged_edge_lines) + "".join(footer)


###############################################################################
# New step 2: apply wild-card compression to each edge label                  #
###############################################################################


def _merge_patterns(patterns, base=2):
    """
    Iteratively merges patterns that form a complete set for the given base.
    
    Logic:
    1. Identify a position `i`.
    2. Group strings that are identical everywhere *except* at `i`.
    3. If a group contains exactly `base` distinct concrete digits (or at least one wildcard),
       at position `i`, we merge them into a single string with `*` at `i`.
    """
    if not patterns:
        return []

    # Working set
    current = set(patterns)
    width = len(next(iter(current)))  # Assume all labels have same width
    
    changed = True
    while changed:
        changed = False
        
        # Try to merge at every position index
        for i in range(width):
            # Dictionary mapping the "context" (string with char i removed) to the set of characters found at position i.
            groups = defaultdict(set)
            
            for pat in current:
                key = pat[:i] + '?' + pat[i+1:] # placeholder '?' to represent the position we are analyzing
                groups[key].add(pat[i])

            # Check every group to see if we can merge
            for key, chars in groups.items():
                if len(chars) == base or ('*' in chars and len(chars) > 1):
                    
                    # Construct the new pattern with wildcard
                    merged_pat = key.replace('?', '*')
                    
                    # Reconstruct the parts that formed this merge and remove them 
                    # if they haven't been used by a previous iteration of this loop
                    parts_to_remove = {key.replace('?', c) for c in chars}
                    
                    if parts_to_remove.issubset(current):
                        current.difference_update(parts_to_remove)
                        current.add(merged_pat)
                        changed = True

    return sorted(current)

def simplify_automaton_labels(dot: str, base: int) -> str:
    """
    Take a DOT string of a finite automaton, merge the transition
    labels per the given rule, and return the updated DOT string.
    """
    label_re = re.compile(r'\[label="([^"]+)"\]')

    def _replace(match):
        raw = match.group(1)
        parts = [p.strip() for p in raw.split(',')]
        merged = _merge_patterns(parts, base)
        return f'[label="{", ".join(sorted(merged))}"]'

    return label_re.sub(_replace, dot)

###############################################################################
def parse_dot_edges(dot_string):
    edge_pattern = re.compile(r'(\w+)\s*->\s*(\w+)')
    graph = defaultdict(list)
    nodes = set()

    for match in edge_pattern.finditer(dot_string):
        src, dst = match.groups()
        graph[src].append(dst)
        nodes.update([src, dst])

    # Find potential roots (nodes without incoming edges)
    all_destinations = {dst for dests in graph.values() for dst in dests}
    roots = list(nodes - all_destinations)

    return graph, roots, list(nodes)


def compute_depth_and_breadth(graph, roots):
    max_depth = 0
    max_breadth = 0

    visited = set()
    queue = deque()

    for root in roots:
        queue.append((root, 0))  # (node, depth)

    level_count = defaultdict(int)

    while queue:
        node, depth = queue.popleft()
        if node in visited:
            continue
        visited.add(node)

        max_depth = max(max_depth, depth)
        level_count[depth] += 1
        max_breadth = max(max_breadth, level_count[depth])

        for neighbor in graph.get(node, []):
            queue.append((neighbor, depth + 1))

    return max_depth, max_breadth

def decide_rankdir_from_structure(dot_string):
    graph, roots, nodes = parse_dot_edges(dot_string)
    depth, breadth = compute_depth_and_breadth(graph, roots)

    if depth < breadth * 1.2:
        return "TB"  # Tall and narrow → vertical
    else:
        return "LR"  # Wide or balanced → horizontal

def add_rankdir_auto(dot: str, node_count) -> str:
    """
    Inspects the bounding box and node count in the DOT string and inserts:
    - rankdir=LR or TB depending on shape
    - ratio=fill only if node count exceeds a threshold
    """
    lines = dot.strip().splitlines()

    # 3. Decide layout direction
    # 3. Decide layout direction
    #rankdir = decide_rankdir_from_structure(dot)
    # layout = "neato" #if node_count < 10 else "neato"
    # print(node_count)
    layout = "dot"
    size = "16,9"
    ratio = "fill" if node_count > 10 else "auto"
    rankdir = "LR" if node_count < 10 else decide_rankdir_from_structure(dot)
    padding = "0"
    if node_count <= 10:
        padding = "0.8"
    if node_count <= 5:
        padding = "1.2"
    #rankdir = "LR"
    # 4. Insert layout instructions
    for i, line in enumerate(lines):
        if line.strip().startswith("digraph"):
            # Insert after "digraph G {"
            if node_count <= 10:
                insert_lines = [
                    f'layout={layout};',
                    f'rankdir={rankdir};',
                    f'size="{size}";',
                    f'ratio={ratio};',
                    f'graph [pad="{padding}"];',
                ]
            else:
                insert_lines = [
                    f'layout={layout};',
                    f'rankdir={rankdir};',
                    f'ratio={ratio};',
                    f'size="{size}";',
                ]
            #if node_count >= 5:  # apply ratio=fill only if graph is "big enough"
            #insert_lines.insert(0, 'ratio=fill;')
            for j, content in enumerate(insert_lines):
                lines.insert(i + 1 + j, content)
            break

    return "\n".join(lines)

def strip_state_names(dot: str) -> str:
    pattern = r'node\s*\[\s*shape\s*=\s*circle\s*\]\s*;'
    return re.sub(pattern, 'node [shape=circle, label=""];', dot, count=1)

def drop_plain_circle_nodes(dot: str) -> str:
    pattern = r'^\s*\d+\s*\[\s*shape\s*=\s*circle\s*\]\s*;\s*$'
    # keep every line that does *not* match the pattern
    return "\n".join(
        line for line in dot.splitlines()
        if not re.match(pattern, line)
    )


# ------------------------------------------------------------------
def rewrite_nodes_with_decode(dot: str) -> str:
    """
    Apply decode(k) to every positive integer token that is
    * outside double quotes,
    * not immediately preceded/followed by a letter,
    * not preceded by a minus sign.

    This handles node declarations, transitions, and “iN → N” start edges.
    """
    # regex for a standalone positive integer (no letter, no minus)
    num_pat = re.compile(r'(?<![A-Za-z\-])(\d+)(?![A-Za-z])')

    def repl(match: re.Match) -> str:
        return str(decode(int(match.group(1))))

    def transform(chunk: str) -> str:
        # apply replacement only to chunks *outside* quotes
        return num_pat.sub(repl, chunk)

    # split line by double quotes so numbers inside labels stay intact
    parts = re.split(r'(".*?")', dot)
    for i in range(0, len(parts), 2):          # even indices → outside quotes
        parts[i] = transform(parts[i])
    return "".join(parts)


def aut_to_dot(aut, variable_order, new_variable_order = None, display_labels = True, display_atomic_construction = False, base = 2):
    dot = aut.to_dot_str()
    node_count = len(aut.get_reachable_states())
    print(dot)
    # Only convert labels for bases 2-36 (supports 0-9, A-Z notation)
    if base <= 36:
        dot = convert_int_labels_to_digitstrings(dot, len(variable_order), base)
    print(dot)
    if new_variable_order:
        if set(new_variable_order) != set(variable_order):
            raise AssertionError(
                "variable_order must be a permutation of the internal "
                f"variables {variable_order}, got {new_variable_order}"
            )
        # Reordering only makes sense when labels are converted to digit strings (bases <= 36)
        if base <= 36:
            mapping = {
                old_idx: new_variable_order.index(var)
                for old_idx, var in enumerate(variable_order)
            }
            dot = reorder_digitstring_labels(dot, mapping, len(variable_order))
    print(dot)
    if not display_labels:
        dot = strip_state_names(dot)
    if display_atomic_construction:
        dot = drop_plain_circle_nodes(dot)
        dot = rewrite_nodes_with_decode(dot)
    print(dot)
    dot = merge_parallel_edges(dot)
    # Simplification only makes sense for digit string labels (bases <= 36)
    if base <= 36:
        dot = simplify_automaton_labels(dot, base)
    dot = add_rankdir_auto(dot, node_count)
    dot = optimize_dot_start_arrow(dot)
    print(dot)
    return dot