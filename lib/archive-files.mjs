import {one} from './db.mjs';

// Migrasi arsip atomik. Periksa katalog sebelum membaca tabel modul, sehingga
// gateway baru tetap dapat melayani modul lama sebelum migrasi dipasang.
// Generator cloud mengganti kueri katalog SQLite ini dengan katalog PostgreSQL.
export function archiveSchemaReady(db){
 return Number(one(db,"SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('archive_records','archive_officers','archive_document_versions')").n)===3;
}

// Ikatan tetap berlaku bagi versi lama, lampiran dilepas, dan arsip dihapus.
// Berkas tersebut hanya boleh dibaca melalui otorisasi rute E-Arsip.
export function archiveFileLinked(db,fileId){
 return archiveSchemaReady(db)&&Boolean(one(db,'SELECT 1 AS linked FROM archive_document_versions WHERE file_id=?',fileId));
}
