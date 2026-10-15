"""Contract drift tests: generated OpenAPI vs maintained openapi/openapi.yaml."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.main import app

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "openapi" / "openapi.yaml"


@pytest.fixture(scope="module")
def contract() -> dict:
    return yaml.safe_load(CONTRACT_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def generated() -> dict:
    return app.openapi()


def test_contract_methods_and_operation_ids(contract: dict, generated: dict) -> None:
    for path, spec in contract["paths"].items():
        assert path in generated["paths"], f"missing path in generated spec: {path}"
        for method, operation in spec.items():
            gen = generated["paths"][path].get(method)
            assert gen is not None, f"missing {method.upper()} {path}"
            assert gen["operationId"] == operation["operationId"]


def _schema_type_and_format(schema: dict) -> tuple[str | None, str | None]:
    """Normalize a schema, unwrapping anyOf used for optional parameters."""
    if "anyOf" in schema:
        for option in schema["anyOf"]:
            if option.get("type") != "null":
                return option.get("type"), option.get("format")
    return schema.get("type"), schema.get("format")


def test_query_parameters_match(contract: dict, generated: dict) -> None:
    for path, spec in contract["paths"].items():
        for method, operation in spec.items():
            expected = {p["name"]: p for p in operation.get("parameters", [])}
            actual = {
                p["name"]: p
                for p in generated["paths"][path][method].get("parameters", [])
                if p["in"] == "query"
            }
            assert set(expected) == set(actual), f"query params drift for {method} {path}"
            for name, param in expected.items():
                assert param["required"] is actual[name]["required"]
                assert _schema_type_and_format(param["schema"]) == _schema_type_and_format(
                    actual[name]["schema"]
                ), f"query param schema drift for {name} on {method} {path}"


def test_response_status_codes_match(contract: dict, generated: dict) -> None:
    for path, spec in contract["paths"].items():
        for method, operation in spec.items():
            expected = set(operation["responses"])
            actual = set(generated["paths"][path][method]["responses"])
            actual.discard("422")
            assert expected == actual, f"response drift for {method} {path}"


def test_restore_is_deprecated(contract: dict, generated: dict) -> None:
    assert contract["paths"]["/restore"]["get"]["deprecated"] is True
    assert generated["paths"]["/restore"]["get"]["deprecated"] is True


def test_request_body_required_flags(contract: dict, generated: dict) -> None:
    for path, spec in contract["paths"].items():
        for method, operation in spec.items():
            expected = operation.get("requestBody", {}).get("required")
            actual = generated["paths"][path][method].get("requestBody", {}).get("required")
            assert expected == actual, f"requestBody required drift for {method} {path}"


def test_schema_property_names_match(contract: dict, generated: dict) -> None:
    for name, schema in contract["components"]["schemas"].items():
        gen_schema = generated["components"]["schemas"][name]
        expected_props = set(schema.get("properties", {}))
        actual_props = set(gen_schema.get("properties", {}))
        assert expected_props == actual_props, f"property drift for schema {name}"
        assert set(schema.get("required", [])) == set(gen_schema.get("required", []))


def test_no_undocumented_paths(contract: dict, generated: dict) -> None:
    documented = set(contract["paths"])
    actual = {p for p in generated["paths"] if not p.startswith("/docs")}
    assert actual == documented, f"unexpected paths: {actual - documented}"
