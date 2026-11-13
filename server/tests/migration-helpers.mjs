import { readFileSync } from 'node:fs';

/** Keep CREATE TRIGGER ... BEGIN ... END together as one SQLite statement. */
export function migrationStatements(source) {
    const triggers=[];
    const rest=source.replace(/CREATE TRIGGER\b[\s\S]*?\bEND\s*;/gi,value=>{
        triggers.push(value);return `SELECT '__migration_trigger_${triggers.length-1}__';`;
    });
    return rest.split(';').map(value=>value.trim()).filter(Boolean).map(value=>{
        const match=/SELECT '__migration_trigger_(\d+)__'$/.exec(value);
        if(!match)return value;
        const prefix=value.slice(0,match.index);
        return prefix+triggers[Number(match[1])];
    });
}
export async function applyMigration(database,name) {
    for(const sql of migrationStatements(readFileSync('migrations/'+name,'utf8')))await database.prepare(sql).run();
}
