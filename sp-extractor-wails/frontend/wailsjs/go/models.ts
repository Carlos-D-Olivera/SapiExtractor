export namespace config {
	
	export class AutoCompleteItem {
	    id: string;
	    code: string;
	    query: string;
	    seleccionar: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AutoCompleteItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.code = source["code"];
	        this.query = source["query"];
	        this.seleccionar = source["seleccionar"];
	    }
	}
	export class SavedConnection {
	    dbType: string;
	    host: string;
	    port: string;
	    dbName: string;
	    user: string;
	    passwordBase64: string;
	    rememberPassword: boolean;
	    lastUsed: number;
	
	    static createFrom(source: any = {}) {
	        return new SavedConnection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dbType = source["dbType"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.dbName = source["dbName"];
	        this.user = source["user"];
	        this.passwordBase64 = source["passwordBase64"];
	        this.rememberPassword = source["rememberPassword"];
	        this.lastUsed = source["lastUsed"];
	    }
	}

}

export namespace db {
	
	export class ConnInfo {
	    dbType: string;
	    host: string;
	    port: string;
	    dbName: string;
	    user: string;
	    password: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dbType = source["dbType"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.dbName = source["dbName"];
	        this.user = source["user"];
	        this.password = source["password"];
	    }
	}
	export class DbObject {
	    type: string;
	    schema: string;
	    parentName: string;
	    name: string;
	    definition?: string;
	
	    static createFrom(source: any = {}) {
	        return new DbObject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.schema = source["schema"];
	        this.parentName = source["parentName"];
	        this.name = source["name"];
	        this.definition = source["definition"];
	    }
	}
	export class ForeignKey {
	    name: string;
	    fromSchema: string;
	    fromTable: string;
	    fromColumn: string;
	    toSchema: string;
	    toTable: string;
	    toColumn: string;
	
	    static createFrom(source: any = {}) {
	        return new ForeignKey(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.fromSchema = source["fromSchema"];
	        this.fromTable = source["fromTable"];
	        this.fromColumn = source["fromColumn"];
	        this.toSchema = source["toSchema"];
	        this.toTable = source["toTable"];
	        this.toColumn = source["toColumn"];
	    }
	}
	export class TableColumn {
	    name: string;
	    dataType: string;
	    nullable: boolean;
	    primaryKey: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TableColumn(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.dataType = source["dataType"];
	        this.nullable = source["nullable"];
	        this.primaryKey = source["primaryKey"];
	    }
	}
	export class SchemaTable {
	    schema: string;
	    name: string;
	    columns: TableColumn[];
	
	    static createFrom(source: any = {}) {
	        return new SchemaTable(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.name = source["name"];
	        this.columns = this.convertValues(source["columns"], TableColumn);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SchemaModel {
	    tables: SchemaTable[];
	    edges: ForeignKey[];
	
	    static createFrom(source: any = {}) {
	        return new SchemaModel(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tables = this.convertValues(source["tables"], SchemaTable);
	        this.edges = this.convertValues(source["edges"], ForeignKey);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class TableScript {
	    id: string;
	    label: string;
	    sql: string;
	
	    static createFrom(source: any = {}) {
	        return new TableScript(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.sql = source["sql"];
	    }
	}

}

export namespace debug {
	
	export class Arg {
	    name: string;
	    value: string;
	    isNull: boolean;
	    useDefault: boolean;
	    output: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Arg(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	        this.isNull = source["isNull"];
	        this.useDefault = source["useDefault"];
	        this.output = source["output"];
	    }
	}
	export class ColChange {
	    column: string;
	    before?: string;
	    after?: string;
	
	    static createFrom(source: any = {}) {
	        return new ColChange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.column = source["column"];
	        this.before = source["before"];
	        this.after = source["after"];
	    }
	}
	export class RowUpdate {
	    key: string;
	    changes: ColChange[];
	
	    static createFrom(source: any = {}) {
	        return new RowUpdate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.changes = this.convertValues(source["changes"], ColChange);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DataChange {
	    table: string;
	    columns: string[];
	    primaryKey: string[];
	    inserted: string[][];
	    deleted: string[][];
	    updated: RowUpdate[];
	    insertedCount: number;
	    deletedCount: number;
	    updatedCount: number;
	    rowsBefore: number;
	    rowsAfter: number;
	    skippedColumns: string[];
	    skipped: string;
	
	    static createFrom(source: any = {}) {
	        return new DataChange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.table = source["table"];
	        this.columns = source["columns"];
	        this.primaryKey = source["primaryKey"];
	        this.inserted = source["inserted"];
	        this.deleted = source["deleted"];
	        this.updated = this.convertValues(source["updated"], RowUpdate);
	        this.insertedCount = source["insertedCount"];
	        this.deletedCount = source["deletedCount"];
	        this.updatedCount = source["updatedCount"];
	        this.rowsBefore = source["rowsBefore"];
	        this.rowsAfter = source["rowsAfter"];
	        this.skippedColumns = source["skippedColumns"];
	        this.skipped = source["skipped"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Message {
	    kind: string;
	    text: string;
	    number: number;
	    line: number;
	    proc: string;
	
	    static createFrom(source: any = {}) {
	        return new Message(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.text = source["text"];
	        this.number = source["number"];
	        this.line = source["line"];
	        this.proc = source["proc"];
	    }
	}
	export class NameValue {
	    name: string;
	    value?: string;
	
	    static createFrom(source: any = {}) {
	        return new NameValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	    }
	}
	export class Param {
	    name: string;
	    type: string;
	    isOutput: boolean;
	    hasDefault: boolean;
	    unsupported: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Param(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.isOutput = source["isOutput"];
	        this.hasDefault = source["hasDefault"];
	        this.unsupported = source["unsupported"];
	    }
	}
	export class ParamInput {
	    name: string;
	    value: string;
	    isNull: boolean;
	    useDefault: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ParamInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	        this.isNull = source["isNull"];
	        this.useDefault = source["useDefault"];
	    }
	}
	export class Prefill {
	    schema: string;
	    name: string;
	    args: Arg[];
	    parsed: boolean;
	    candidates: string[];
	
	    static createFrom(source: any = {}) {
	        return new Prefill(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.name = source["name"];
	        this.args = this.convertValues(source["args"], Arg);
	        this.parsed = source["parsed"];
	        this.candidates = source["candidates"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Request {
	    schema: string;
	    name: string;
	    params: ParamInput[];
	    rollback: boolean;
	    maxRows: number;
	    trackData: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Request(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.name = source["name"];
	        this.params = this.convertValues(source["params"], ParamInput);
	        this.rollback = source["rollback"];
	        this.maxRows = source["maxRows"];
	        this.trackData = source["trackData"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ResultSet {
	    columns: string[];
	    types: string[];
	    rows: string[][];
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ResultSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = source["columns"];
	        this.types = source["types"];
	        this.rows = source["rows"];
	        this.truncated = source["truncated"];
	    }
	}
	export class Source {
	    key: string;
	    name: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new Source(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.name = source["name"];
	        this.text = source["text"];
	    }
	}
	export class Step {
	    seq: number;
	    kind: string;
	    object: string;
	    sourceKey: string;
	    level: number;
	    line: number;
	    endLine: number;
	    text: string;
	    durationUs: number;
	    cpuUs: number;
	    reads: number;
	    writes: number;
	    rows: number;
	    count: number;
	    branch: string;
	    note: string;
	    errorNumber: number;
	    severity: number;
	    children: Step[];
	
	    static createFrom(source: any = {}) {
	        return new Step(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.seq = source["seq"];
	        this.kind = source["kind"];
	        this.object = source["object"];
	        this.sourceKey = source["sourceKey"];
	        this.level = source["level"];
	        this.line = source["line"];
	        this.endLine = source["endLine"];
	        this.text = source["text"];
	        this.durationUs = source["durationUs"];
	        this.cpuUs = source["cpuUs"];
	        this.reads = source["reads"];
	        this.writes = source["writes"];
	        this.rows = source["rows"];
	        this.count = source["count"];
	        this.branch = source["branch"];
	        this.note = source["note"];
	        this.errorNumber = source["errorNumber"];
	        this.severity = source["severity"];
	        this.children = this.convertValues(source["children"], Step);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Result {
	    steps: Step[];
	    sources: Source[];
	    sets: ResultSet[];
	    messages: Message[];
	    returnValue?: string;
	    outputs: NameValue[];
	    changes: DataChange[];
	    failed: boolean;
	    rolledBack: boolean;
	    durationMs: number;
	    stepCount: number;
	    notes: string[];
	    batch: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.steps = this.convertValues(source["steps"], Step);
	        this.sources = this.convertValues(source["sources"], Source);
	        this.sets = this.convertValues(source["sets"], ResultSet);
	        this.messages = this.convertValues(source["messages"], Message);
	        this.returnValue = source["returnValue"];
	        this.outputs = this.convertValues(source["outputs"], NameValue);
	        this.changes = this.convertValues(source["changes"], DataChange);
	        this.failed = source["failed"];
	        this.rolledBack = source["rolledBack"];
	        this.durationMs = source["durationMs"];
	        this.stepCount = source["stepCount"];
	        this.notes = source["notes"];
	        this.batch = source["batch"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	

}

export namespace main {
	
	export class ExportRequest {
	    objects: db.DbObject[];
	    outDir: string;
	
	    static createFrom(source: any = {}) {
	        return new ExportRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.objects = this.convertValues(source["objects"], db.DbObject);
	        this.outDir = source["outDir"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class InsertScriptRequest {
	    schema: string;
	    table: string;
	    columns: string[];
	    types: string[];
	    rows: string[][];
	    detectTypes: boolean;
	    batchSize: number;
	    identityInsert: boolean;
	    deleteFirst: boolean;
	
	    static createFrom(source: any = {}) {
	        return new InsertScriptRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.table = source["table"];
	        this.columns = source["columns"];
	        this.types = source["types"];
	        this.rows = source["rows"];
	        this.detectTypes = source["detectTypes"];
	        this.batchSize = source["batchSize"];
	        this.identityInsert = source["identityInsert"];
	        this.deleteFirst = source["deleteFirst"];
	    }
	}
	export class ResultSet {
	    columns: string[];
	    types: string[];
	    rows: string[][];
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ResultSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = source["columns"];
	        this.types = source["types"];
	        this.rows = source["rows"];
	        this.truncated = source["truncated"];
	    }
	}
	export class QueryResponse {
	    sets: ResultSet[];
	    message: string;
	    durationMs: number;
	    rowCount: number;
	
	    static createFrom(source: any = {}) {
	        return new QueryResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sets = this.convertValues(source["sets"], ResultSet);
	        this.message = source["message"];
	        this.durationMs = source["durationMs"];
	        this.rowCount = source["rowCount"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace trace {
	
	export class Options {
	    minDurationMs: number;
	    includeOwn: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Options(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.minDurationMs = source["minDurationMs"];
	        this.includeOwn = source["includeOwn"];
	    }
	}

}

