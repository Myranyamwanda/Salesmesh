"""Query parameters and helpers shared by the paginated admin lists."""

from typing import Annotated, Literal

from fastapi import Query
from sqlalchemy import ColumnElement

type Offset = Annotated[int, Query(ge=0)]
type Limit = Annotated[int, Query(ge=1, le=100)]
type Search = Annotated[str, Query(max_length=100)]
# "dir" is a Python built-in, so the parameter is named direction in code.
type Direction = Annotated[Literal["asc", "desc"], Query(alias="dir")]


def contains(column, term: str) -> ColumnElement[bool]:
    """Case-insensitive "contains" for a search box; % and _ match literally."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")
