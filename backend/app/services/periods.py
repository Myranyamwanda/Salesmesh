"""Calendar months used by the client trend and the model monitoring card."""

from datetime import date

from sqlalchemy import func


def recent_months(today: date, count: int) -> list[date]:
    """The first day of the last `count` months, oldest first."""
    months = []
    year, month = today.year, today.month
    for _ in range(count):
        months.append(date(year, month, 1))
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return months[::-1]


def utc_month(column):
    """SQL expression: the calendar month (in UTC) of a timestamp column."""
    return func.date_trunc("month", func.timezone("UTC", column))
