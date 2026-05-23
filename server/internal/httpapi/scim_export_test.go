package httpapi

// scim_export_test.go — export private helpers for white-box tests.

// SCIMParseFilterExported wraps scimParseFilter for external tests.
func SCIMParseFilterExported(filter string) (string, []interface{}) {
	return scimParseFilter(filter)
}

// SCIMExtractValueEqExported wraps scimExtractValueEq for external tests.
func SCIMExtractValueEqExported(path string) string {
	return scimExtractValueEq(path)
}
