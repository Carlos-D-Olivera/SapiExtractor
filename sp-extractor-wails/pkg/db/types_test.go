package db

import "testing"

func TestDbObjectFullName(t *testing.T) {
	objWithSchema := DbObject{
		Schema: "sales",
		Name:   "Orders",
		Type:   Table,
	}
	if got := objWithSchema.FullName(); got != "sales.Orders" {
		t.Errorf("FullName() = %q, expected %q", got, "sales.Orders")
	}

	objWithoutSchema := DbObject{
		Schema: "",
		Name:   "GlobalSetting",
		Type:   Table,
	}
	if got := objWithoutSchema.FullName(); got != "GlobalSetting" {
		t.Errorf("FullName() = %q, expected %q", got, "GlobalSetting")
	}

	objColumn := DbObject{
		Schema:     "dbo",
		ParentName: "Users",
		Name:       "Email",
		Type:       Column,
	}
	if got := objColumn.FullName(); got != "dbo.Users → Email" {
		t.Errorf("FullName() = %q, expected %q", got, "dbo.Users → Email")
	}
}

func TestDbTypeConstants(t *testing.T) {
	if SQLServer != "SQL_SERVER" {
		t.Errorf("expected SQL_SERVER, got %s", SQLServer)
	}
	if MySQL != "MYSQL" {
		t.Errorf("expected MYSQL, got %s", MySQL)
	}
	if PostgreSQL != "POSTGRESQL" {
		t.Errorf("expected POSTGRESQL, got %s", PostgreSQL)
	}
}
