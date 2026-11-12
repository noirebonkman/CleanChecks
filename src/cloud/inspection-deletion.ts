import { hasPermission } from '../access-control';
import type { Inspection, State } from '../inspection-model';
import { post, ServerError, type ServerUser } from './client';
import { listRemoteRecords, synchronizeCloud } from './synchronization';

export type InspectionDeleteTarget = {id:string;ownerId:string;siteName:string;date:string;revision?:number};
export const inspectionDeleteTarget = (record:Inspection):InspectionDeleteTarget => ({id:record.id,ownerId:record.staffId,siteName:record.site.name,date:record.date});
export function canDeleteInspection(user:ServerUser,target:InspectionDeleteTarget):boolean {
    return user.role==='owner' || (target.ownerId===user.id && hasPermission(user,'writeOwnRecords'));
}

/** The server marks the record deleted; encrypted recovery and audit are retained. */
export async function deleteInspection(target:InspectionDeleteTarget,user:ServerUser,getState:()=>State,save:(state:State)=>Promise<void>,password='') {
    if(!canDeleteInspection(user,target))throw Error('본인의 점검표만 삭제할 수 있습니다.');
    if(!navigator.onLine)throw Error('인터넷에 연결한 뒤 삭제해 주세요. 점검표는 그대로 유지됩니다.');
    let revision=target.revision,alreadyDeleted=false;
    const own=target.ownerId===user.id;
    if(revision===undefined){
        if(own){
            const synced=await synchronizeCloud(user,getState,save);
            if(synced.conflictIds.includes(target.id))throw Error('점검표가 다른 기기에서 변경되었습니다. 최신 내용을 확인한 뒤 삭제해 주세요.');
            const known=getState().cloud?.records[target.id];
            revision=known?.revision;alreadyDeleted=known?.fingerprint===null;
        }else{
            const remote=(await listRemoteRecords('admin/records')).find(row=>row.id===target.id);
            revision=remote?.revision;alreadyDeleted=!!remote?.deleted;
        }
    }
    if(revision===undefined)throw Error('서버의 점검표를 확인하지 못했습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요.');
    if(!alreadyDeleted){
        try {
            const result=await post<{revision:number}>(own?'records/'+target.id:'owner/records/'+target.id,
                {revision,...(!own?{password,reason:'점검 목록에서 삭제'}:{})},'DELETE');
            revision=result.revision;
        } catch(error) {
            if(error instanceof ServerError && [401,403].includes(error.status))throw error;
            // A lost response or failed local save must not duplicate the deletion audit.
            const remote=await listRemoteRecords(own?'records':'admin/records').catch(()=>[]);
            const deleted=remote.find(row=>row.id===target.id&&row.deleted&&row.revision>revision!);
            if(!deleted)throw error;
            revision=deleted.revision;
        }
    }
    const current=getState(),link=current.cloud;
    await save({...current,records:current.records.filter(record=>record.id!==target.id),
        ...(own&&link?{cloud:{...link,records:{...link.records,[target.id]:{revision,fingerprint:null}}}}:{})});
    window.dispatchEvent(new Event('cleanchecks:inspections-changed'));
}
