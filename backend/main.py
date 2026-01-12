import os

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from lark import UnexpectedInput
from typing import List
from presburger_converter import formula_to_aut

from presburger_converter.solutions import find_example_solutions
from presburger_converter.automaton.mata_io import nfa_to_mata, nfa_from_mata
from presburger_converter.viz import aut_to_dot

app = FastAPI()

class FormulaRequest(BaseModel):
    formula: str
    display_labels: bool = True
    display_atomic_construction: bool = False
    base: int = 2

class SolutionsRequest(BaseModel):
    aut: str
    k_solutions: int
    original_variable_order: List[str]
    new_variable_order: List[str]
    display_atomic_construction: bool = False
    formula: str = None
    base: int = 2

class ReorderRequest(BaseModel):
    aut: str
    k_solutions: int
    original_variable_order: List[str]
    new_variable_order: List[str]
    display_labels: bool = True
    display_atomic_construction: bool = False
    formula: str = None
    base: int = 2

@app.post("/automaton/dot")
async def automaton_dot(req: FormulaRequest):
    formula = req.formula
    k_solutions = 9 if req.base <= 10 else 0
    try:
        if req.base < 2:
            raise AssertionError("Base must be at least 2.")
        aut_minimized, aut, variable_order = formula_to_aut(formula, req.display_atomic_construction, req.base)
        example_solutions = find_example_solutions(aut_minimized, k_solutions, variable_order, base=req.base)
        dot_string = aut_to_dot(aut, variable_order, display_labels=req.display_labels, display_atomic_construction=req.display_atomic_construction, base=req.base)
        mata_string = nfa_to_mata(aut)
        num_states = len(aut.get_reachable_states())
        num_final_states = len(aut.final_states)
    except UnexpectedInput as exc:
        try:
            context = exc.get_context(formula)
        except Exception:
            context = str(exc)
        return Response(
            content="Syntax error:\n" + context,
            media_type="text/plain",
            status_code=400,
        )
    except AssertionError as exc:
        return Response(
            content="Syntax error:\n" + str(exc),
            media_type="text/plain",
            status_code=400,
        )

    return JSONResponse(
        content={
            "dot": dot_string,
            "variables": variable_order,
            "example_solutions": example_solutions,
            "mata": mata_string,
            "num_states": num_states,
            "num_final_states": num_final_states,
        }
    )

@app.post("/automaton/solutions")
async def automaton_solutions(req: SolutionsRequest):
    try:
        if req.display_atomic_construction:
            aut_minimized, aut, variable_order = formula_to_aut(req.formula, req.display_atomic_construction, req.base)
        else:
            aut = nfa_from_mata(req.aut)
            aut_minimized = aut
        example_solutions = find_example_solutions(
            aut_minimized,
            req.k_solutions,
            req.original_variable_order,
            req.new_variable_order if req.new_variable_order != req.original_variable_order else None,
            base=req.base
        )
        number_of_new_solutions = 5 - (req.k_solutions - len(example_solutions))
        if number_of_new_solutions <= 0:
            new_solutions = []
        else:
            new_solutions = example_solutions[-number_of_new_solutions:]
    except (UnexpectedInput, AssertionError) as exc:
        return Response(
            content=f"Syntax error:\n{str(exc)}",
            media_type="text/plain",
            status_code=400,
        )

    return JSONResponse(
        content={
            "example_solutions": new_solutions,
            "solution_set_full": number_of_new_solutions != 5,
        }
    )


@app.post("/automaton/reorder")
async def automaton_reorder(req: ReorderRequest):
    try:
        if req.display_atomic_construction:
            aut_minimized, aut, variable_order = formula_to_aut(req.formula, req.display_atomic_construction, req.base)
        else:
            aut = nfa_from_mata(req.aut)
            aut_minimized = aut
        if req.base < 2:
            raise AssertionError("Base must be at least 2.")
        example_solutions = find_example_solutions(
            aut_minimized,
            req.k_solutions,
            req.original_variable_order,
            req.new_variable_order,
            base=req.base
        )
        dot_string = aut_to_dot(
            aut,
            req.original_variable_order,
            req.new_variable_order,
            req.display_labels,
            req.display_atomic_construction,
            req.base
        )
    except (UnexpectedInput, AssertionError) as exc:
        return Response(
            content=f"Syntax error:\n{str(exc)}",
            media_type="text/plain",
            status_code=400,
        )

    return JSONResponse(
        content={
            "reordered_solutions": example_solutions,
            "dot": dot_string,
        }
    )