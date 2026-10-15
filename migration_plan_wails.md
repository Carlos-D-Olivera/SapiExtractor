# Migration Plan: SpExtractor → Wails (Go + React/Tailwind)

## Overview
**Goal:** Re‑implement the desktop UI of **SpExtractor** using **Wails** (Go backend + React/Tailwind frontend) while preserving the existing database‑extraction logic. This will give us modern hot‑reload UI, a lightweight native Windows executable, and easier future maintenance.

---

## Phase 0 – Preparation (1 day)
| Task | Description | Status |
|---|---|:---:|
| Install toolchain | Install **Go 1.22+**, **Node 20+**, **npm**, **Wails v2** (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`). | ✅ Done |
| Repository setup | Add a `README.migration.md` to track progress. | ✅ Done |
| Knowledge transfer | Read the current `README.md`, review DB extractor classes (`SqlServerExtractor`, `MySqlExtractor`, `PostgreSqlExtractor`). | ✅ Done |

---

## Phase 1 – Scaffold Wails Project (1 day)
1. Run `wails init -n sp-extractor-wails -t react`.
2. Choose **Tailwind CSS** when prompted (or add manually later).
3. Commit the generated skeleton.

---

## Phase 2 – Port Backend to Go (≈ 5 days)
| Sub‑task | Details |
|---|---|
| Create Go modules | `go mod init github.com/yourorg/sp-extractor-wails` |
| DB driver packages | * **SQL Server** – `github.com/microsoft/go-mssqldb`\n* **MySQL** – `github.com/go-sql-driver/mysql`\n* **PostgreSQL** – `github.com/jackc/pgx/v5` |
| Strategy pattern | Define `type Extractor interface { ExtractNames(db *sql.DB) ([]string, error); FillDefinition(name string, db *sql.DB) (string, error) }` and implement three structs (`SqlServerExtractor`, `MySqlExtractor`, `PostgresExtractor`). |
| Connection manager | Port `ConnectionManager.java` → `pkg/db/conn.go` with functions `Open(connConfig) (*sql.DB, error)` and `Close(*sql.DB)`. |
| Export service | Implement `ExportSPs(ctx context.Context, names []string, outDir string) error` using Go goroutines and a progress channel. |
| Unit tests | Add tests in `pkg/.../extractor_test.go` using `sqlmock` for each driver. |

---

## Phase 3 – Define Wails Bindings (≈ 2 days)
1. In `frontend/src/wailsjs/go/`, expose Go functions via `//export` comments, e.g. `func GetDatabases(connInfo ConnInfo) ([]string, error)`. 
2. Create a thin **service** struct (e.g., `type App struct{}`) with methods `Connect`, `ListProcedures`, `ExportProcedures` that are bound with `runtime.Bind`. 
3. Ensure all exported methods return JSON‑serialisable types (`[]string`, `map[string]string`).

---

## Phase 4 – UI Migration to React/Tailwind (≈ 7 days)
| Component | Mapping |
|---|---|
| Main window (`MainFrame.java`) | `App.tsx` with a sidebar and main content area. |
| Connection dialog | Modal component `ConnectionDialog.tsx`. |
| Procedure list | `ProcedureTable.tsx` using **react‑table** or **MUI DataGrid**. |
| Export button & progress bar | `ExportBar.tsx` with Tailwind‑styled progress bar. |
| Custom Swing components (GradientPanel, IconButton, PillActionButton…) | Replace with Tailwind utility classes and reusable React components (`Button`, `Card`). |

**Styling:**
- Use the existing dark palette from FlatLaf (`#004A77`, `#C2E7FF`).
- Add a Tailwind config extension (`tailwind.config.js`) to define these colors.
- Enable dark mode (`media` or `class`).

---

## Phase 5 – Integration & Async Flow (≈ 2 days)
1. Call Go bindings from React via the generated `window.go` object (`window.go.main.App.Connect(...)`).
2. Wrap calls in `async/await` and update React state (`useState`, `useEffect`).
3. Use a **WebWorker**‑like pattern provided by Wails (`runtime.EventsEmit`) for long‑running export tasks; display real‑time progress in the UI.

---

## Phase 6 – Testing & QA (≈ 3 days)
| Test type | Tool |
|---|---|
| Go unit tests | `go test ./...` |
| Integration tests (Go ↔ React) | Wails `runtime.Test` utilities or manual Cypress scripts. |
| UI regression | **Cypress** (`cypress run`). |
| Windows packaging sanity | Run `wails build -platform windows/amd64` and verify the generated `.exe`. |

---

## Phase 7 – Build & Distribution (1 day)
1. Run `wails build -platform windows/amd64 -output sp-extractor-wails.exe`.
2. Optional: Sign the executable with a code‑signing certificate.
3. Create a simple installer (e.g., **Inno Setup** script) that copies the exe and an optional desktop shortcut.

---

## Phase 8 – Documentation & Handoff (1 day)
- [x] Update `README.md` with new **Build** and **Run** sections.
- [x] Add a `CONTRIBUTING.md` explaining how to develop the React UI (npm scripts) and Go backend.
- [ ] Record a short video demo of the hot‑reload workflow.

---

## Rough Timeline (2 weeks total)
| Week | Focus |
|---|---|
| **1** | Phases 0‑2 (environment, scaffold, backend port). |
| **2** | Phases 3‑5 (UI, bindings, integration). |
| **3** (first 3‑4 days) | Phases 6‑7 (testing, packaging). |
| **3** (last 2 days) | Phase 8 (docs) and final merge. |

---

## Key Resources
- **Wails Documentation:** https://wails.io/docs/
- **Go SQL Drivers:**
  - SQL Server: https://github.com/microsoft/go-mssqldb
  - MySQL: https://github.com/go-sql-driver/mysql
  - PostgreSQL: https://github.com/jackc/pgx
- **React + Tailwind Starter:** https://tailwindcss.com/docs/guides/create-react-app
- **Wails React Template (GitHub):** https://github.com/wailsapp/wails-react-template
- **Cypress E2E:** https://docs.cypress.io/guides/overview/why-cypress

---

### Success Criteria
- ✅ All three DB engines can be connected and stored procedures listed/exported **via the new UI**.
- ✅ Windows executable size < 20 MB, launches without requiring a JDK.
- ✅ UI hot‑reload works; a UI change reflects instantly after saving a `.tsx` file.
- ✅ No regression in existing functionality (verified by unit + integration tests).

---

*Feel free to adjust sprint lengths or add extra buffer days for unforeseen integration quirks.*
