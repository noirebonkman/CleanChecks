import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(!existsSync('.dev.vars')){
 writeFileSync('.dev.vars','APP_DATA_KEY="'+randomBytes(32).toString('base64')+'"\nSETUP_TOKEN="'+randomBytes(32).toString('hex')+'"\n',{mode:0o600});
 console.log('로컬 전용 .dev.vars를 만들었습니다. 최초 설정 코드는 이 파일의 SETUP_TOKEN입니다. Git에 올리지 마세요.');
}
