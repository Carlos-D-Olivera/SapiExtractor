export namespace config {
	
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

