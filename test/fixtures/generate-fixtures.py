#!/usr/bin/env python3
"""
Generate .numbers fixture files for testing.

Requires: pip3 install numbers-parser

Run from project root:
    python3 test/fixtures/generate-fixtures.py
"""

import sys
from pathlib import Path

try:
    from numbers_parser import Document
except ImportError:
    print("Error: numbers-parser not installed. Run: pip3 install numbers-parser")
    sys.exit(1)

FIXTURES_DIR = Path(__file__).parent


def create_basic_fixture():
    """Create a simple spreadsheet with one sheet and one table."""
    doc = Document()
    sheet = doc.sheets[0]
    table = sheet.tables[0]

    # Set headers
    table.write(0, 0, "Name")
    table.write(0, 1, "Age")
    table.write(0, 2, "City")

    # Set data rows
    data = [
        ("Alice", 30, "New York"),
        ("Bob", 25, "San Francisco"),
        ("Charlie", 35, "Chicago"),
        ("Diana", 28, "Seattle"),
    ]
    for row_idx, (name, age, city) in enumerate(data, start=1):
        table.write(row_idx, 0, name)
        table.write(row_idx, 1, age)
        table.write(row_idx, 2, city)

    path = FIXTURES_DIR / "basic.numbers"
    doc.save(str(path))
    print(f"Created: {path}")


def create_multisheet_fixture():
    """Create a spreadsheet with multiple sheets and tables."""
    doc = Document()

    # Sheet 1: Employees
    sheet1 = doc.sheets[0]
    sheet1.name = "Employees"
    t1 = sheet1.tables[0]
    t1.write(0, 0, "ID")
    t1.write(0, 1, "Name")
    t1.write(0, 2, "Department")
    t1.write(1, 0, 1)
    t1.write(1, 1, "Alice")
    t1.write(1, 2, "Engineering")
    t1.write(2, 0, 2)
    t1.write(2, 1, "Bob")
    t1.write(2, 2, "Marketing")

    # Sheet 2: Revenue
    doc.add_sheet("Revenue")
    sheet2 = doc.sheets[1]
    t2 = sheet2.tables[0]
    t2.write(0, 0, "Quarter")
    t2.write(0, 1, "Amount")
    t2.write(1, 0, "Q1")
    t2.write(1, 1, 100000)
    t2.write(2, 0, "Q2")
    t2.write(2, 1, 150000)

    path = FIXTURES_DIR / "multisheet.numbers"
    doc.save(str(path))
    print(f"Created: {path}")


def create_types_fixture():
    """Create a spreadsheet with various data types."""
    from datetime import datetime, date

    doc = Document()
    sheet = doc.sheets[0]
    table = sheet.tables[0]

    table.write(0, 0, "Type")
    table.write(0, 1, "Value")

    table.write(1, 0, "String")
    table.write(1, 1, "Hello World")
    table.write(2, 0, "Integer")
    table.write(2, 1, 42)
    table.write(3, 0, "Float")
    table.write(3, 1, 3.14)
    table.write(4, 0, "Boolean")
    table.write(4, 1, True)
    table.write(5, 0, "Empty")
    # Leave (5,1) empty

    path = FIXTURES_DIR / "types.numbers"
    doc.save(str(path))
    print(f"Created: {path}")


if __name__ == "__main__":
    print(f"Generating fixtures in {FIXTURES_DIR}...")
    create_basic_fixture()
    create_multisheet_fixture()
    create_types_fixture()
    print("Done!")
