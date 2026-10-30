import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const format = 'cleanchecks-d1-backup-v1';

export function readBackupKey(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) throw Error('백업 암호화 키는 32바이트 Base64 값이어야 합니다.');
    const key = Buffer.from(text, 'base64');
    if (key.length !== 32 || key.toString('base64') !== text) throw Error('백업 암호화 키 형식이 올바르지 않습니다.');
    return key;
}
export async function encryptBackup(input, output, key) {
    if (key.length !== 32) throw Error('백업 암호화 키 길이가 잘못되었습니다.');
    const source = resolve(input), destination = resolve(output);
    if (source === destination) throw Error('원본과 암호화 파일 경로는 달라야 합니다.');
    if ((await stat(source)).size === 0) throw Error('빈 백업은 저장하지 않습니다.');
    const iv = randomBytes(12);
    const header = Buffer.from(JSON.stringify({ format, createdAt: new Date().toISOString(), iv: iv.toString('base64') }));
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(header);
    let created = false;
    try {
        await writeFile(destination, Buffer.concat([header, Buffer.from('\n')]), { flag: 'wx', mode: 0o600 });
        created = true;
        await pipeline(createReadStream(source), cipher, createWriteStream(destination, { flags: 'a', mode: 0o600 }));
        await appendFile(destination, cipher.getAuthTag());
    } catch (error) {
        if (created) await unlink(destination).catch(() => {});
        throw error;
    }
}
export async function decryptBackup(input, output, key) {
    if (resolve(input) === resolve(output)) throw Error('원본 백업을 덮어쓸 수 없습니다.');
    const file = await open(input, 'r');
    let header, size, end, tag;
    try {
        size = (await file.stat()).size;
        const prefix = Buffer.alloc(Math.min(4096, size));
        await file.read(prefix, 0, prefix.length, 0);
        end = prefix.indexOf(10);
        if (end < 0 || size <= end + 17) throw Error('백업 파일이 손상되었습니다.');
        header = prefix.subarray(0, end);
        tag = Buffer.alloc(16);
        await file.read(tag, 0, 16, size - 16);
    } finally { await file.close(); }
    let metadata;
    try { metadata = JSON.parse(header.toString('utf8')); } catch { throw Error('백업 형식을 확인해 주세요.'); }
    const iv = Buffer.from(metadata.iv || '', 'base64');
    if (metadata.format !== format || iv.length !== 12) throw Error('지원하지 않는 백업 형식입니다.');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(header); decipher.setAuthTag(tag);
    const destination = resolve(output);
    const writer = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    let created = false;
    writer.once('open', () => { created = true; });
    try {
        await pipeline(createReadStream(input, { start: end + 1, end: size - 17 }), decipher, writer);
    } catch (error) {
        if (created) await unlink(destination).catch(() => {});
        throw Error('복호화에 실패했습니다. 키나 파일을 확인하세요. 기존 파일은 덮어쓰지 않았습니다.');
    }
}
async function main() {
    const keyFile = resolve(root, 'private/github-backup-key.txt');
    const command = process.argv[2];
    if (command === 'keygen') {
        await mkdir(dirname(keyFile), { recursive: true });
        await writeFile(keyFile, randomBytes(32).toString('base64') + '\n', { flag: 'wx', mode: 0o600 });
        console.log('private/github-backup-key.txt 생성 완료. 내용을 출력하거나 Git에 올리지 않습니다.');
        return;
    }
    if (command === 'decrypt' && process.argv[3] && process.argv[4]) {
        const key = readBackupKey(process.env.BACKUP_ENCRYPTION_KEY || await readFile(keyFile, 'utf8'));
        await decryptBackup(process.argv[3], process.argv[4], key);
        console.log('SQL 복호화 완료. 복호화된 파일은 private 폴더에 안전하게 보관하세요.');
        return;
    }
    throw Error('사용법: node tools/github-backup.mjs keygen 또는 decrypt <암호화백업> <새 SQL 파일>');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => { console.error(error.code === 'EEXIST' ? '파일이 이미 있습니다. 기존 키나 백업을 덮어쓰지 않습니다.' : error.message); process.exitCode = 1; });
}
