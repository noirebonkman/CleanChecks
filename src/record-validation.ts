import {grades,sections,type Inspection,type Site} from './inspection-model';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const strings=(value:Record<string,unknown>,keys:string[])=>keys.every(key=>typeof value[key]==='string');
const timestamp=(value:unknown)=>typeof value==='string'&&value.trim()!==''&&Number.isFinite(Date.parse(value));
const answerKeys=new Set(sections.flatMap((section,si)=>section.items.map((_,i)=>`${si}-${i}`)));
export function validSite(value:unknown):value is Site{
 return object(value)&&strings(value,['id','name','zone','address','priority','cycle'])&&['id','name','zone','address'].every(key=>(value[key] as string).trim()!=='');
}
/** Validate the existing backup schema before any record is merged into local state. */
export function validInspection(value:unknown):value is Inspection{
 if(!object(value)||!strings(value,['id','staffId','date','type','cycle','technician','rating','issues','action','assignee','due','actionState','notes','updated'])||!(value.id as string).trim()||!(value.staffId as string).trim()||!validSite(value.site)||!timestamp(value.date)||!timestamp(value.updated)||typeof value.modified!=='boolean'||!['draft','complete'].includes(value.status as string))return false;
 if(value.completed!==undefined&&!timestamp(value.completed))return false;
 if(!['','양호','보통','개선 필요','집중 관리'].includes(value.rating as string)||!['','미조치','조치 중','완료'].includes(value.actionState as string)||value.due!==''&&!timestamp(value.due))return false;
 if(!object(value.answers)||!Object.entries(value.answers).every(([key,grade])=>answerKeys.has(key)&&grades.includes(grade as typeof grades[number])))return false;
 if(!Array.isArray(value.photos)||!value.photos.every(photo=>object(photo)&&strings(photo,['id','name','data'])&&(photo.id as string).trim()!==''&&/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo.data as string)))return false;
 if(new Set(value.photos.map(photo=>photo.id)).size!==value.photos.length)return false;
 return Array.isArray(value.history)&&value.history.every(item=>object(item)&&timestamp(item.at));
}
