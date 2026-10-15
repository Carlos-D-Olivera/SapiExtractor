package db

import (
	"testing"

	"github.com/microsoft/go-mssqldb/msdsn"
)

func TestBuildSQLServerDSNWithInstance(t *testing.T) {
	cases := []struct {
		name     string
		host     string
		port     string
		dbName   string
		wantHost string
		wantInst string
		wantPort uint64
		wantDB   string
	}{
		{
			name:     "backslash instance ignores port",
			host:     `192.168.1.207\SQL2022`,
			port:     "1433",
			dbName:   "master",
			wantHost: "192.168.1.207",
			wantInst: "SQL2022",
			wantPort: 0, // port must be dropped so SQL Browser resolves the instance
			wantDB:   "master",
		},
		{
			name:     "forward slash instance ignores port",
			host:     "192.168.1.207/SQL2022",
			port:     "1433",
			dbName:   "master",
			wantHost: "192.168.1.207",
			wantInst: "SQL2022",
			wantPort: 0,
			wantDB:   "master",
		},
		{
			name:     "plain host no instance",
			host:     "192.168.1.207",
			port:     "1433",
			dbName:   "master",
			wantHost: "192.168.1.207",
			wantInst: "",
			wantPort: 1433,
			wantDB:   "master",
		},
		{
			name:     "instance without database (server-only)",
			host:     `dbhost\SQLEXPRESS`,
			port:     "",
			dbName:   "",
			wantHost: "dbhost",
			wantInst: "SQLEXPRESS",
			wantPort: 0,
			wantDB:   "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dsn := buildDSN(ConnInfo{
				DbType:   SQLServer,
				Host:     tc.host,
				Port:     tc.port,
				DbName:   tc.dbName,
				User:     "sa",
				Password: "sa1_xxxx",
			}, tc.dbName == "")

			cfg, err := msdsn.Parse(dsn)
			if err != nil {
				t.Fatalf("msdsn.Parse(%q) returned error: %v", dsn, err)
			}
			if cfg.Host != tc.wantHost {
				t.Errorf("Host = %q, want %q", cfg.Host, tc.wantHost)
			}
			if cfg.Instance != tc.wantInst {
				t.Errorf("Instance = %q, want %q", cfg.Instance, tc.wantInst)
			}
			if cfg.Port != tc.wantPort {
				t.Errorf("Port = %d, want %d", cfg.Port, tc.wantPort)
			}
			if cfg.Database != tc.wantDB {
				t.Errorf("Database = %q, want %q", cfg.Database, tc.wantDB)
			}
			if cfg.User != "sa" {
				t.Errorf("User = %q, want %q", cfg.User, "sa")
			}
			if cfg.Password != "sa1_xxxx" {
				t.Errorf("Password = %q, want %q", cfg.Password, "sa1_xxxx")
			}
		})
	}
}

func TestBuildSQLServerDSNEscapesCredentials(t *testing.T) {
	dsn := buildDSN(ConnInfo{
		DbType:   SQLServer,
		Host:     `host\INST`,
		Port:     "1433",
		DbName:   "db",
		User:     "user@domain",
		Password: `p@ss:word/?#`,
	}, false)

	cfg, err := msdsn.Parse(dsn)
	if err != nil {
		t.Fatalf("msdsn.Parse(%q) returned error: %v", dsn, err)
	}
	if cfg.User != "user@domain" {
		t.Errorf("User = %q, want %q", cfg.User, "user@domain")
	}
	if cfg.Password != `p@ss:word/?#` {
		t.Errorf("Password = %q, want %q", cfg.Password, `p@ss:word/?#`)
	}
	if cfg.Instance != "INST" {
		t.Errorf("Instance = %q, want %q", cfg.Instance, "INST")
	}
}

func TestBuildDSNInstanceInHostDoesNotBreakURLParse(t *testing.T) {
	// Regression: previously produced sqlserver://sa:pass@192.168.1.207\SQL2022:1433
	// which failed with `invalid character "\" in host name`.
	dsn := buildDSN(ConnInfo{
		DbType:   SQLServer,
		Host:     `192.168.1.207\SQL2022`,
		Port:     "1433",
		DbName:   "master",
		User:     "sa",
		Password: "sa1_xxxx",
	}, false)

	if _, err := msdsn.Parse(dsn); err != nil {
		t.Fatalf("expected DSN %q to parse, got error: %v", dsn, err)
	}
}
