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
	export class ResultSet {
	    columns: string[];
	    rows: string[][];
	
	    static createFrom(source: any = {}) {
	        return new ResultSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = source["columns"];
	        this.rows = source["rows"];
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

