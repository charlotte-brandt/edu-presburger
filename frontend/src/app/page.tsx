'use client';

import { useState, useRef, useEffect } from 'react';
import Script from 'next/script';
import GraphvizViewer from './components/GraphvizViewer';
import ExampleSolutions from './components/ExampleSolutions';

// Add ExampleSolution type at the top (or import from ExampleSolutions if you prefer)
type ExampleSolution = {
  path_int: number[];
  path_bits: string[];
  variables: string[];
  var_bits: { [key: string]: string };
  var_ints: { [key: string]: number };
};

type ReorderRequestBody = {
  aut: string;
  k_solutions: number;
  original_variable_order: string[];
  new_variable_order: string[];
  display_labels: boolean;
  display_atomic_construction: boolean;
  formula?: string;
  base: number;
};

type SolutionsRequestBody = {
  aut: string;
  k_solutions: number;
  original_variable_order: string[];
  new_variable_order: string[];
  display_atomic_construction: boolean;
  formula?: string;
  base: number;
};

export default function Home() {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dotString, setDotString] = useState<string>();
  const [mataString, setMataString] = useState<string>();
  const [variables, setVariables] = useState<string[]>([]);
  const [originalVariables, setOriginalVariables] = useState<string[]>([]);
  const [currentVariables, setCurrentVariables] = useState<string[]>([]);
  const [displayedSolutions, setDisplayedSolutions] = useState<ExampleSolution[]>([]);
  const [bufferSolutions, setBufferSolutions] = useState<ExampleSolution[]>([]);
  const [isFullSolutionSet, setIsFullSolutionSet] = useState(false);
  const [isRefillingBuffer, setIsRefillingBuffer] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [kSolutions, setKSolutions] = useState(3);
  const [numStates, setNumStates] = useState<number>(0);
  const [numFinalStates, setNumFinalStates] = useState<number>(0);
  const [displayLabels, setDisplayLabels] = useState<boolean>(true);
  const [displayAtomicConstruction, setDisplayAtomicConstruction] = useState<boolean>(false);
  const [base, setBase] = useState<number>(2);
  const [lastGeneratedBase, setLastGeneratedBase] = useState<number>(2);
  const [requestedSolutions, setRequestedSolutions] = useState<number>(0);
  const scrollPositionRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const allSolutionsRef = useRef<ExampleSolution[]>([]);

  // Effect to restore scroll position after loading completes
  useEffect(() => {
    if (!loading && dotString) {
      // Small delay to ensure the graph is fully rendered
      setTimeout(() => {
        window.scrollTo(0, scrollPositionRef.current);
      }, 100);
    }
  }, [loading, dotString]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result as string;
        setInput(content);
        setKSolutions(3);
        // Always build with the new content, regardless of previous state
        await handleBuild(content);
        // Clear the file input after successful upload
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      };
      reader.readAsText(file);
    }
  };

  const handleBuild = async (formulaOverride?: string) => {
    // Save current scroll position before any state changes
    scrollPositionRef.current = window.scrollY;
    
    setLoading(true);
    setError(null);
    setDotString(undefined);
    setMataString(undefined);
    setBufferSolutions([]);
    setDisplayedSolutions([]);
    setIsFullSolutionSet(false);
    try {
      const requestBody = {
        formula: (formulaOverride ?? input).trim(),
        display_labels: displayLabels,
        display_atomic_construction: displayAtomicConstruction,
        base: base,
      };

      const response = await fetch('/api/automaton/dot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMsg = errorText
          .replace(/\t/g, '    ')
          .replace(/ /g, '\u00A0');
        console.log('Error message received:', JSON.stringify(errorMsg));
        setError(errorMsg);
        return;
      }

      const data = await response.json();
      console.log('API response:', data);
      setDotString(data.dot);
      setMataString(data.mata);
      setVariables(data.variables || []);
      setOriginalVariables(data.variables || []);
      setCurrentVariables(data.variables || []);
      allSolutionsRef.current = data.example_solutions || [];
      if ((data.example_solutions || []).length < 9) {
        setDisplayedSolutions(data.example_solutions || []); // Show all if full set
        setBufferSolutions([]);
        setIsFullSolutionSet(true);
      } else {
        setDisplayedSolutions((data.example_solutions || []).slice(0, 3));
        setBufferSolutions((data.example_solutions || []).slice(3));
        setIsFullSolutionSet(false);
      }
      setNumStates(data.num_states);
      setNumFinalStates(data.num_final_states);
      setLastGeneratedBase(base); // Track the base used for this generation
    } catch (err) {
      const errorMsg = (err instanceof Error ? err.message : 'An error occurred')
        .replace(/\t/g, '    ')
        .replace(/ /g, '\u00A0');
      console.log('Error message received:', JSON.stringify(errorMsg));
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleReorder = async (newVariableOrder: string[]) => {
    if (!mataString) return;
    
    setLoading(true);
    setError(null);
    try {
      const numDisplayed = displayedSolutions.length;
      const numBuffered = bufferSolutions.length;
      const totalNeeded = numDisplayed + numBuffered;
      const requestBody: ReorderRequestBody = {
        aut: mataString,
        k_solutions: totalNeeded,
        original_variable_order: originalVariables,
        new_variable_order: newVariableOrder,
        display_labels: displayLabels,
        display_atomic_construction: displayAtomicConstruction,
        base: base,
      };

      // Add formula to request if display atomic construction is enabled
      if (displayAtomicConstruction) {
        requestBody.formula = input.trim();
      }

      const response = await fetch('/api/automaton/reorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMsg = errorText
          .replace(/\t/g, '    ')
          .replace(/ /g, '\u00A0');
        console.log('Error message received:', JSON.stringify(errorMsg));
        setError(errorMsg);
        return;
      }

      const data = await response.json();
      console.log('Reorder API response:', data);
      
      // Update DOT string if provided
      if (data.dot !== null && data.dot !== undefined) {
        setDotString(data.dot);
      }
      
      // Replace all solutions with reordered ones, preserving the number of displayed and buffered solutions
      const reorderedSolutions = data.reordered_solutions || [];
      const newDisplayed = reorderedSolutions.slice(0, numDisplayed);
      const newBuffer = reorderedSolutions.slice(numDisplayed, totalNeeded);

      setDisplayedSolutions(newDisplayed);
      setBufferSolutions(newBuffer);

      // If the backend returned fewer than needed, mark as full set
      if (reorderedSolutions.length <= numDisplayed) {
        setIsFullSolutionSet(true);
      } else {
        setIsFullSolutionSet(false);
      }
      
    } catch (err) {
      const errorMsg = (err instanceof Error ? err.message : 'An error occurred')
        .replace(/\t/g, '    ')
        .replace(/ /g, '\u00A0');
      console.log('Error message received:', JSON.stringify(errorMsg));
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleGetSolutions = async (kOverride?: number) => {
    if (!mataString) return;
    
    setLoading(true);
    setError(null);
    try {
      const requestBody: SolutionsRequestBody = {
        aut: mataString,
        k_solutions: kOverride ?? kSolutions,
        original_variable_order: originalVariables,
        new_variable_order: currentVariables,
        display_atomic_construction: displayAtomicConstruction,
        base: base,
      };

      // Add formula to request if display atomic construction is enabled
      if (displayAtomicConstruction) {
        requestBody.formula = input.trim();
      }

      const response = await fetch('/api/automaton/solutions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMsg = errorText
          .replace(/\t/g, '    ')
          .replace(/ /g, '\u00A0');
        console.log('Error message received:', JSON.stringify(errorMsg));
        setError(errorMsg);
        return;
      }

      const data = await response.json();
      console.log('Solutions API response:', data);
      
      const newSolutions = data.example_solutions || [];
      console.log('=== SOLUTIONS RESPONSE RECEIVED ===');
      console.log('Response contains', newSolutions.length, 'new solutions');
      console.log('Solution set full:', data.solution_set_full);
      
      // Add new solutions to buffer
      console.log('Adding', newSolutions.length, 'new solutions to buffer');
      
      setBufferSolutions(prev => {
        const newBuffer = [...prev, ...newSolutions];
        console.log('Buffer updated:');
        console.log('- Previous buffer size:', prev.length);
        console.log('- New buffer size:', newBuffer.length);
        console.log('- Added solutions:', newSolutions.length);
        return newBuffer;
      });
      
      // Use the backend's solution_set_full boolean
      console.log('Setting full solution set to:', data.solution_set_full);
      setIsFullSolutionSet(data.solution_set_full || false);
      
      setIsRefillingBuffer(false);
      console.log('Refill completed, isRefillingBuffer set to false');
    } catch (err) {
      const errorMsg = (err instanceof Error ? err.message : 'An error occurred')
        .replace(/\t/g, '    ')
        .replace(/ /g, '\u00A0');
      console.log('Error message received:', JSON.stringify(errorMsg));
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null) return;

    const newVariables = [...currentVariables];
    const [draggedItem] = newVariables.splice(draggedIndex, 1);
    newVariables.splice(targetIndex, 0, draggedItem);

    setCurrentVariables(newVariables);
    setDraggedIndex(null);
    await handleReorder(newVariables);
  };

  const handleFormulaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setKSolutions(3);
  };

  const handleAddExample = async () => {
    console.log('=== BUTTON CLICKED ===');
    console.log('Current state:');
    console.log('- Displayed solutions:', displayedSolutions.length);
    console.log('- Buffer solutions:', bufferSolutions.length);
    console.log('- Is full solution set:', isFullSolutionSet);
    console.log('- Is refilling buffer:', isRefillingBuffer);
    console.log('- Requested solutions:', requestedSolutions);

    // If we have the full solution set, show all solutions (displayed + buffer)
    if (isFullSolutionSet) {
      console.log('Full solution set detected, showing all solutions');
      setDisplayedSolutions(prev => [...prev, ...bufferSolutions]);
      setBufferSolutions([]);
      return;
    }

    // Get the next solution from the buffer
    if (bufferSolutions.length > 0) {
      const nextSolution = bufferSolutions[0];
      const remainingBuffer = bufferSolutions.slice(1);
      
      console.log('Taking solution from buffer:');
      console.log('- Next solution index:', displayedSolutions.length + 1);
      console.log('- Remaining buffer size:', remainingBuffer.length);
      
      setDisplayedSolutions(prev => [...prev, nextSolution]);
      setBufferSolutions(remainingBuffer);
      
      // Check if we need to refill the buffer
      if (remainingBuffer.length === 4 && !isRefillingBuffer && !isFullSolutionSet) {
        console.log('Buffer has 4 solutions left, triggering refill');
        setIsRefillingBuffer(true);
        const currentDisplayed = displayedSolutions.length + 1; // +1 for the solution we just added
        const nextK = currentDisplayed + 9; // displayed + 4 remaining + 5 new
        setRequestedSolutions(5); // We're requesting 5 new solutions
        setKSolutions(nextK);
        await handleGetSolutions(nextK);
      } else {
        console.log('No refill needed, buffer size:', remainingBuffer.length);
      }
    } else {
      console.log('Buffer is empty, no more solutions to display');
    }
  };

  const isButtonDisabled = () => {
    // Show loading when buffer is empty and refilling
    return bufferSolutions.length === 0 && isRefillingBuffer;
  };

  const handleDownloadDot = () => {
    if (!dotString) return;
    const blob = new Blob([dotString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'automaton.dot';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadMata = () => {
    if (!mataString) return;
    const blob = new Blob([mataString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'automaton.mata';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen p-8">
      <Script
        src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"
        strategy="beforeInteractive"
      />
      
      <div className="max-w-[85%] mx-auto space-y-8">
        <h1 className="text-3xl font-bold text-center">Presburger Arithmetical Expression to Automaton</h1>
        
        <div className="space-y-4">
          <textarea
            value={input}
            onChange={handleFormulaChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                setKSolutions(3);
                handleBuild();
              }
            }}
            placeholder="Enter a Presburger Arithmetical Expression..."
            className="w-full h-32 p-4 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-2xl"
          />
          
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              Upload Formula
              <input
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                className="hidden"
                ref={fileInputRef}
              />
            </label>
            <span className="text-sm text-gray-500">Upload a .txt file containing your formula</span>
            {dotString && (
              <div className="ml-auto flex gap-2">
                <button
                  onClick={handleDownloadDot}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Download .dot
                </button>
                <button
                  onClick={handleDownloadMata}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Download .mata
                </button>
              </div>
            )}
          </div>
          
          {/* Display Labels Toggle */}
          <div className="flex items-center gap-2">
            <input
              id="display-labels-toggle"
              type="checkbox"
              checked={displayLabels}
              onChange={() => setDisplayLabels((prev) => !prev)}
              className="form-checkbox h-5 w-5 text-blue-600 transition duration-150 ease-in-out"
            />
            <label htmlFor="display-labels-toggle" className="text-gray-700 select-none cursor-pointer">
              Display labels on automaton
            </label>
          </div>
          {/* Display Atomic Construction Toggle */}
          <div className="flex items-center gap-2">
            <input
              id="display-atomic-toggle"
              type="checkbox"
              checked={displayAtomicConstruction}
              onChange={() => setDisplayAtomicConstruction((prev) => !prev)}
              className="form-checkbox h-5 w-5 text-blue-600 transition duration-150 ease-in-out"
            />
            <label htmlFor="display-atomic-toggle" className="text-gray-700 select-none cursor-pointer">
              Display atomic construction <span className="text-xs text-yellow-600">(Warning: Can result in non-minimal automaton, only works on formulas of the form s &lt;= t)</span>
            </label>
          </div>
          
          {/* Base Input */}
          <div className="flex items-center gap-2">
            <label htmlFor="base-input" className="text-gray-700 select-none">
              Encoding Base:
            </label>
            <input
              id="base-input"
              type="number"
              min="2"
              value={base}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val >= 2) {
                  setBase(val);
                }
              }}
              className="w-20 px-3 py-1 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <span className="text-sm text-gray-500">(2 for binary, 10 for decimal, etc. Labels shown for bases 2-36, structure only for bases &gt; 36)</span>
          </div>
          
          {/* Help Section */}
          <div className="mt-2">
            <button
              type="button"
              className="text-blue-600 underline text-sm focus:outline-none"
              onClick={() => setShowHelp((prev) => !prev)}
              aria-expanded={showHelp}
              aria-controls="formula-help-section"
            >
              {showHelp ? 'Hide syntax help' : 'Need help with the syntax?'}
            </button>
            {showHelp && (
              <div
                id="formula-help-section"
                className="mt-2 p-4 bg-gray-50 border border-gray-200 rounded text-sm text-gray-800"
              >
                <div className="mb-2 font-semibold">Formula Syntax Help</div>
                <div className="mb-2">
                  <span className="font-semibold">Macros:</span><br />
                  Define macros at the beginning of your input, one per line. After the macros, add your formula on a new line.<br />
                  <span className="text-gray-600">Example:</span><br />
                  <span className="block font-mono bg-gray-100 rounded p-2 my-1">LessThan(x, y) = x &lt; y</span>
                  <span className="block font-mono bg-gray-100 rounded p-2 my-1">IsEven(x) = EX y. x = 2y</span>
                  <span className="block font-mono bg-gray-100 rounded p-2 my-1">LessThan(x, y) AND IsEven(z)</span>
                </div>
                <div className="mb-2">
                  <span className="font-semibold">Boolean connectives:</span><br />
                  <span className="font-mono">AND</span>, <span className="font-mono">OR</span>, <span className="font-mono">NOT</span>, <span className="font-mono">-&gt;</span>, <span className="font-mono">&lt;-&gt;</span><br />
                  <span className="text-gray-600">Example: <span className="font-mono">(x = y) AND (NOT (x &lt; 3))</span></span>
                </div>
                <div className="mb-2">
                  <span className="font-semibold">Quantifiers:</span><br />
                  <span className="font-mono">EX x. ...</span> (there exists), <span className="font-mono">ALL y. ...</span> (for all)<br />
                  <span className="text-gray-600">Example: <span className="font-mono">EX z. x = 4z</span>, <span className="font-mono">ALL y. y &lt;= x</span></span>
                </div>
                <div className="mb-2">
                  <span className="font-semibold">Comparisons:</span><br />
                  <span className="font-mono">=</span>, <span className="font-mono">&lt;=</span>, <span className="font-mono">&lt;</span>, <span className="font-mono">&gt;=</span>, <span className="font-mono">&gt;</span><br />
                  <span className="text-gray-600">Example: <span className="font-mono">x = y + 2</span>, <span className="font-mono">3z &lt; y</span></span>
                </div>
                <div className="mb-2">
                  <span className="font-semibold">Arithmetic:</span><br />
                  <span className="font-mono">x + y</span>, <span className="font-mono">2x + 3</span><br />
                  <span className="text-gray-600">Example: <span className="font-mono">x = y + 2</span>, <span className="font-mono">2x + 3</span></span>
                </div>
                <div className="mb-2">
                  <span className="font-semibold">Full formula examples:</span><br />
                  <span className="block font-mono bg-gray-100 rounded p-2 my-1">x = y + 2</span>
                  <span className="block font-mono bg-gray-100 rounded p-2 my-1">EX z. x = 4z</span>
                  <span className="block font-mono bg-gray-100 rounded p-2 my-1">ALL y. y &lt;= x</span>
                  <span className="block font-mono bg-gray-100 rounded p-2 my-1">(x = y) AND (NOT (x &lt; 3))</span>
                  <span className="block font-mono bg-gray-100 rounded p-2 my-1">EX x. (x &lt; 3) -&gt; (y = x + 2)</span>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  <span className="font-semibold">Grammar:</span><br />
                  <pre className="whitespace-pre-wrap font-mono text-xs bg-gray-100 rounded p-2 mt-1">{`
?start: formula
?formula: implication
?implication: equivalence | equivalence "->" implication  -> implies
?equivalence: or_expr | or_expr "<->" equivalence         -> iff
?or_expr: and_expr | or_expr "OR" and_expr                -> or_expr
?and_expr: not_expr | and_expr "AND" not_expr             -> and_expr
?not_expr: "NOT" atom -> not_expr | atom
?atom: comparison | quantifier | "(" formula ")"
?quantifier: EX VAR "." formula -> ex_quantifier | ALL VAR "." formula -> all_quantifier
?comparison: term "<=" term -> leq | term "=" term -> eq | term "<" term -> less | term ">" term -> greater | term ">=" term -> greater_equal
?term: sum
?sum: product | sum "+" product -> add
?product: CONST VAR -> mult | factor
?factor: VAR -> var | CONST -> const
VAR: /[a-z][a-z0-9_]*/i
CONST: /[0-9]+/
`}</pre>
                </div>
              </div>
            )}
          </div>
          
          <button
            onClick={() => { setKSolutions(3); handleBuild(); }}
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (isRefillingBuffer ? 'Loading solutions...' : 'Building...') : 'Build Automaton'}
          </button>
        </div>

        {error && (
          <pre
            className="p-4 bg-red-100 text-red-700 rounded-lg whitespace-pre-wrap font-mono"
            style={{ fontFamily: 'JetBrains Mono, Fira Mono, Menlo, Consolas, monospace', fontSize: '16px' }}
          >
            {error}
          </pre>
        )}

        {/* Example Solutions and Graph display */}
        {dotString && (
          <>
            <ExampleSolutions
              solutions={displayedSolutions}
              bufferSolutions={bufferSolutions}
              onAddExample={handleAddExample}
              isFullSolutionSet={isFullSolutionSet}
              isButtonDisabled={isButtonDisabled()}
              base={lastGeneratedBase}
            />
            
            {variables.length > 0 && (
              <div className="flex flex-col gap-2 my-4">
                <span className="font-semibold text-gray-700">Variable order (drag to reorder):</span>
                <div className="flex flex-wrap items-center gap-2">
                  {currentVariables.map((v, i) => (
                    <div
                      key={v}
                      draggable
                      onDragStart={() => handleDragStart(i)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, i)}
                      className={`px-3 py-2 bg-blue-100 text-blue-800 rounded font-mono border border-blue-200 cursor-move hover:bg-blue-200 transition-colors ${
                        draggedIndex === i ? 'opacity-50' : ''
                      }`}
                    >
                      {v}
                    </div>
                  ))}
                  <div className="ml-auto flex items-center gap-2">
                    <div className="px-3 py-2 bg-blue-100 text-blue-800 rounded font-mono border border-blue-200">
                      <span className="font-semibold">States:</span> {numStates}
                    </div>
                    <div className="px-3 py-2 bg-green-100 text-green-800 rounded font-mono border border-green-200">
                      <span className="font-semibold">Final:</span> {numFinalStates}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="border rounded-lg overflow-hidden">
              <div className="w-full aspect-[16/9]">
                <GraphvizViewer dot={dotString} />
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
