use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Cursor, Read, Seek, SeekFrom, Write};
use std::path::Path;

const CODE: &str = "CBB-SECURITY-0001";
const FALLBACK_ID: &str = "00000000-0000-4000-8000-000000000000";
const OPERATIONS: [&str; 5] = [
    "inspectArchive",
    "sanitizeSvg",
    "canonicalizeRaster",
    "inspectFont",
    "flattenPdf",
];

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u8,
    #[serde(rename = "requestId")]
    request_id: String,
    operation: String,
    input: String,
    output: String,
    limits: Value,
}

#[derive(Debug)]
struct WorkerError {
    reason: &'static str,
    message: &'static str,
}

impl WorkerError {
    fn invalid(message: &'static str) -> Self {
        Self {
            reason: "invalidContent",
            message,
        }
    }

    fn limit(message: &'static str) -> Self {
        Self {
            reason: "limitExceeded",
            message,
        }
    }

    fn unavailable(message: &'static str) -> Self {
        Self {
            reason: "isolationUnavailable",
            message,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveLimits {
    #[serde(rename = "compressedBytes")]
    compressed_bytes: u64,
    #[serde(rename = "uncompressedBytes")]
    uncompressed_bytes: u64,
    entries: u64,
    #[serde(rename = "entryBytes")]
    entry_bytes: u64,
    #[serde(rename = "compressionRatio")]
    compression_ratio: u64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SvgLimits {
    #[serde(rename = "inputBytes")]
    input_bytes: u64,
    #[serde(rename = "outputBytes")]
    output_bytes: u64,
    #[serde(rename = "xmlNodes")]
    xml_nodes: u64,
    #[serde(rename = "pathCommands")]
    path_commands: u64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RasterLimits {
    #[serde(rename = "inputBytes")]
    input_bytes: u64,
    #[serde(rename = "outputBytes")]
    output_bytes: u64,
    #[serde(rename = "decodedPixels")]
    decoded_pixels: u64,
    width: u64,
    height: u64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct FontLimits {
    #[serde(rename = "inputBytes")]
    input_bytes: u64,
    #[serde(rename = "outputBytes")]
    output_bytes: u64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PdfLimits {
    #[serde(rename = "inputBytes")]
    input_bytes: u64,
    #[serde(rename = "outputBytes")]
    output_bytes: u64,
    pages: u64,
}

pub fn uncorrelated_failure(reason: &'static str, message: &'static str) -> Value {
    failure_value(FALLBACK_ID, "sanitizeSvg", reason, message)
}

pub fn process_json(bytes: &[u8], input: &Path, output: &Path) -> Value {
    let raw: Value = match serde_json::from_slice(bytes) {
        Ok(value) => value,
        Err(_) => {
            return uncorrelated_failure(
                "invalidContent",
                "The quarantine request was not valid bounded JSON.",
            )
        }
    };
    let request_id = raw
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|v| valid_uuid_v4(v))
        .unwrap_or(FALLBACK_ID)
        .to_owned();
    let operation = raw
        .get("operation")
        .and_then(Value::as_str)
        .filter(|v| OPERATIONS.contains(v))
        .unwrap_or("sanitizeSvg")
        .to_owned();
    let request: Request = match serde_json::from_value(raw) {
        Ok(request) => request,
        Err(_) => {
            return failure_value(
                &request_id,
                &operation,
                "invalidContent",
                "The quarantine request schema was invalid.",
            )
        }
    };
    if let Err(error) = validate_request(&request) {
        return failure(&request, error);
    }
    match process(&request, input, output) {
        Ok(value) => value,
        Err(error) => failure(&request, error),
    }
}

fn validate_request(request: &Request) -> Result<(), WorkerError> {
    if request.version != 1
        || !valid_uuid_v4(&request.request_id)
        || !OPERATIONS.contains(&request.operation.as_str())
        || !valid_handle(&request.input)
        || !valid_handle(&request.output)
        || request.input == request.output
    {
        return Err(WorkerError::invalid(
            "The quarantine request identity was invalid.",
        ));
    }
    match request.operation.as_str() {
        "inspectArchive" => {
            let l: ArchiveLimits = decode_limits(&request.limits)?;
            if l.compressed_bytes > 1_073_741_824
                || l.uncompressed_bytes > 4_294_967_296
                || l.entries > 20_000
                || l.entry_bytes > 1_073_741_824
                || l.compression_ratio < 1
                || l.compression_ratio > 200
            {
                return Err(WorkerError::invalid(
                    "The archive limits were outside the hard security bounds.",
                ));
            }
        }
        "sanitizeSvg" => {
            let l: SvgLimits = decode_limits(&request.limits)?;
            if l.input_bytes > 20_971_520
                || l.output_bytes > 20_971_520
                || l.xml_nodes > 200_000
                || l.path_commands > 1_000_000
            {
                return Err(WorkerError::invalid(
                    "The SVG limits were outside the hard security bounds.",
                ));
            }
        }
        "canonicalizeRaster" => {
            let l: RasterLimits = decode_limits(&request.limits)?;
            if l.input_bytes > 524_288_000
                || l.output_bytes > 524_288_000
                || l.decoded_pixels > 100_000_000
                || l.width > 32_768
                || l.height > 32_768
            {
                return Err(WorkerError::invalid(
                    "The raster limits were outside the hard security bounds.",
                ));
            }
        }
        "inspectFont" => {
            let l: FontLimits = decode_limits(&request.limits)?;
            if l.input_bytes > 52_428_800 || l.output_bytes > 52_428_800 {
                return Err(WorkerError::invalid(
                    "The font limits were outside the hard security bounds.",
                ));
            }
        }
        "flattenPdf" => {
            let l: PdfLimits = decode_limits(&request.limits)?;
            if l.input_bytes > 524_288_000 || l.output_bytes > 524_288_000 || l.pages > 1_000 {
                return Err(WorkerError::invalid(
                    "The PDF limits were outside the hard security bounds.",
                ));
            }
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn decode_limits<T: for<'de> Deserialize<'de>>(value: &Value) -> Result<T, WorkerError> {
    serde_json::from_value(value.clone())
        .map_err(|_| WorkerError::invalid("The operation limits were invalid."))
}

fn process(request: &Request, input: &Path, output: &Path) -> Result<Value, WorkerError> {
    match request.operation.as_str() {
        "inspectArchive" => inspect_archive(request, input, output),
        "sanitizeSvg" => sanitize_svg(request, input, output),
        "canonicalizeRaster" => canonicalize_raster(request, input, output),
        "inspectFont" => inspect_font(request, input, output),
        "flattenPdf" => flatten_pdf(request, input),
        _ => unreachable!(),
    }
}

fn failure(request: &Request, error: WorkerError) -> Value {
    failure_value(
        &request.request_id,
        &request.operation,
        error.reason,
        error.message,
    )
}

fn failure_value(request_id: &str, operation: &str, reason: &str, message: &str) -> Value {
    json!({
        "version": 1,
        "requestId": request_id,
        "operation": operation,
        "status": "failed",
        "code": CODE,
        "reason": reason,
        "message": message,
    })
}

fn success_base(
    request: &Request,
    hash: String,
    bytes: u64,
    media_type: &str,
    observed: Value,
) -> Map<String, Value> {
    let mut result = Map::new();
    result.insert("version".into(), json!(1));
    result.insert("requestId".into(), json!(request.request_id));
    result.insert("operation".into(), json!(request.operation));
    result.insert("status".into(), json!("succeeded"));
    result.insert("output".into(), json!(request.output));
    result.insert("outputHash".into(), json!(hash));
    result.insert("outputBytes".into(), json!(bytes));
    result.insert("mediaType".into(), json!(media_type));
    result.insert("observed".into(), observed);
    result
}

fn valid_uuid_v4(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 36
        || b[8] != b'-'
        || b[13] != b'-'
        || b[18] != b'-'
        || b[23] != b'-'
        || b[14] != b'4'
        || !matches!(b[19], b'8' | b'9' | b'a' | b'b')
    {
        return false;
    }
    b.iter().enumerate().all(|(i, c)| {
        matches!(i, 8 | 13 | 18 | 23) || c.is_ascii_digit() || matches!(c, b'a'..=b'f')
    })
}

fn valid_handle(value: &str) -> bool {
    value.len() == 67
        && value.starts_with("qh:")
        && value[3..]
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

struct Sha256 {
    state: [u32; 8],
    buffer: [u8; 64],
    buffered: usize,
    length: u64,
}

impl Sha256 {
    fn new() -> Self {
        Self {
            state: [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
                0x5be0cd19,
            ],
            buffer: [0; 64],
            buffered: 0,
            length: 0,
        }
    }

    fn digest(bytes: &[u8]) -> [u8; 32] {
        let mut value = Self::new();
        value.update(bytes);
        value.finalize()
    }

    fn update(&mut self, mut bytes: &[u8]) {
        self.length = self.length.wrapping_add(bytes.len() as u64);
        if self.buffered != 0 {
            let count = (64 - self.buffered).min(bytes.len());
            self.buffer[self.buffered..self.buffered + count].copy_from_slice(&bytes[..count]);
            self.buffered += count;
            bytes = &bytes[count..];
            if self.buffered == 64 {
                let block = self.buffer;
                self.compress(&block);
                self.buffered = 0;
            }
        }
        while bytes.len() >= 64 {
            let block: &[u8; 64] = bytes[..64].try_into().expect("fixed block");
            self.compress(block);
            bytes = &bytes[64..];
        }
        self.buffer[..bytes.len()].copy_from_slice(bytes);
        self.buffered = bytes.len();
    }

    fn finalize(mut self) -> [u8; 32] {
        let bit_length = self.length.wrapping_mul(8);
        self.buffer[self.buffered] = 0x80;
        self.buffered += 1;
        if self.buffered > 56 {
            self.buffer[self.buffered..].fill(0);
            let block = self.buffer;
            self.compress(&block);
            self.buffer = [0; 64];
        } else {
            self.buffer[self.buffered..56].fill(0);
        }
        self.buffer[56..].copy_from_slice(&bit_length.to_be_bytes());
        let block = self.buffer;
        self.compress(&block);
        let mut digest = [0; 32];
        for (chunk, word) in digest.chunks_exact_mut(4).zip(self.state) {
            chunk.copy_from_slice(&word.to_be_bytes());
        }
        digest
    }

    fn compress(&mut self, block: &[u8; 64]) {
        const K: [u32; 64] = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
            0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
            0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
            0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
            0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
            0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
            0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
            0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
            0xc67178f2,
        ];
        let mut w = [0u32; 64];
        for (word, chunk) in w[..16].iter_mut().zip(block.chunks_exact(4)) {
            *word = u32::from_be_bytes(chunk.try_into().expect("fixed word"));
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (state, value) in self.state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *state = state.wrapping_add(value);
        }
    }
}

fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>, WorkerError> {
    let meta = fs::metadata(path)
        .map_err(|_| WorkerError::invalid("The quarantine input could not be read."))?;
    if !meta.is_file() {
        return Err(WorkerError::invalid(
            "The quarantine input was not a regular file.",
        ));
    }
    if meta.len() > limit {
        return Err(WorkerError::limit(
            "The quarantine input exceeded its authorized byte limit.",
        ));
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    File::open(path)
        .and_then(|f| f.take(limit.saturating_add(1)).read_to_end(&mut bytes))
        .map_err(|_| WorkerError::invalid("The quarantine input could not be read."))?;
    if bytes.len() as u64 > limit {
        return Err(WorkerError::limit(
            "The quarantine input exceeded its authorized byte limit.",
        ));
    }
    Ok(bytes)
}

fn write_output(path: &Path, bytes: &[u8], limit: u64) -> Result<(), WorkerError> {
    if bytes.len() as u64 > limit {
        return Err(WorkerError::limit(
            "The canonical output exceeded its authorized byte limit.",
        ));
    }
    let meta = fs::symlink_metadata(path)
        .map_err(|_| WorkerError::invalid("The prepared output slot was unavailable."))?;
    if !meta.file_type().is_file() {
        return Err(WorkerError::invalid(
            "The prepared output slot was not a regular file.",
        ));
    }
    OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.flush()?;
            Ok(())
        })
        .map_err(|_| WorkerError::invalid("The canonical output could not be written."))
}

#[derive(Debug, Serialize)]
struct ClosureEntry<'a> {
    path: &'a str,
    hash: &'a str,
    #[serde(rename = "byteSize")]
    byte_size: u64,
}

fn inspect_archive(request: &Request, input: &Path, output: &Path) -> Result<Value, WorkerError> {
    let limits: ArchiveLimits = decode_limits(&request.limits)?;
    let input_meta = fs::metadata(input)
        .map_err(|_| WorkerError::invalid("The archive input could not be read."))?;
    if !input_meta.is_file() {
        return Err(WorkerError::invalid(
            "The archive input was not a regular file.",
        ));
    }
    let input_bytes = input_meta.len();
    if input_bytes > limits.compressed_bytes {
        return Err(WorkerError::limit(
            "The archive exceeded its compressed-byte limit.",
        ));
    }
    let out_meta = fs::symlink_metadata(output)
        .map_err(|_| WorkerError::invalid("The archive output directory was unavailable."))?;
    if !out_meta.file_type().is_dir() {
        return Err(WorkerError::invalid(
            "The archive output was not a directory.",
        ));
    }
    if fs::read_dir(output)
        .map_err(|_| WorkerError::invalid("The archive output directory could not be inspected."))?
        .next()
        .is_some()
    {
        return Err(WorkerError::invalid(
            "The archive output directory was not empty.",
        ));
    }

    let mut file = BufReader::new(
        File::open(input)
            .map_err(|_| WorkerError::invalid("The archive input could not be opened."))?,
    );
    let central = read_zip_directory(&mut file, input_bytes, limits.entries)?;
    let mut local_ranges = Vec::with_capacity(central.len());
    for metadata in &central {
        let data_start = read_local_header(&mut file, metadata)?;
        let data_end = data_start
            .checked_add(metadata.compressed_bytes)
            .ok_or_else(|| WorkerError::invalid("A ZIP entry range overflowed."))?;
        local_ranges.push((metadata.local_offset, data_end));
    }
    local_ranges.sort_unstable();
    if local_ranges
        .windows(2)
        .any(|ranges| ranges[0].1 > ranges[1].0)
    {
        return Err(WorkerError::invalid(
            "ZIP local entries overlapped or reused payload bytes.",
        ));
    }
    let mut entries = Vec::new();
    let mut archive_paths: BTreeMap<String, (String, bool)> = BTreeMap::new();
    let mut total_uncompressed = 0u64;
    let mut total_compressed = 0u64;
    let mut max_entry = 0u64;
    let mut max_ratio = 1u64;

    for metadata in central {
        let raw_name = metadata.name.as_str();
        register_archive_path(raw_name, metadata.directory, &mut archive_paths)?;
        if metadata.directory {
            let directory = raw_name
                .strip_suffix('/')
                .ok_or_else(|| WorkerError::invalid("The ZIP directory entry was malformed."))?;
            if !safe_archive_path(directory) {
                return Err(WorkerError::invalid(
                    "The ZIP archive contained an unsafe path.",
                ));
            }
            continue;
        }
        if !safe_archive_path(raw_name) {
            return Err(WorkerError::invalid(
                "The ZIP archive contained an unsafe path.",
            ));
        }
        if entries.len() as u64 >= limits.entries {
            return Err(WorkerError::limit("The archive contained too many files."));
        }
        let declared = metadata.uncompressed_bytes;
        let compressed = metadata.compressed_bytes;
        if declared > limits.entry_bytes {
            return Err(WorkerError::limit(
                "An archive entry exceeded its byte limit.",
            ));
        }
        let declared_ratio = ceiling_ratio(declared, compressed);
        if declared_ratio > limits.compression_ratio {
            return Err(WorkerError::limit(
                "An archive entry exceeded its compression-ratio limit.",
            ));
        }

        let destination = output.join(raw_name);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|_| {
                WorkerError::invalid("An archive output directory could not be created.")
            })?;
        }
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|_| {
                WorkerError::invalid("An archive output file could not be created safely.")
            })?;
        let mut hasher = Sha256::new();
        let mut crc = Crc32::new();
        let mut actual = 0u64;
        let mut buffer = [0u8; 65_536];
        let data_start = read_local_header(&mut file, &metadata)?;
        file.seek(SeekFrom::Start(data_start))
            .map_err(|_| WorkerError::invalid("A ZIP entry offset was invalid."))?;
        let compressed_reader = (&mut file).take(compressed);
        let mut decoded: Box<dyn Read + '_> = match metadata.method {
            0 => Box::new(compressed_reader),
            8 => Box::new(flate2::read::DeflateDecoder::new(compressed_reader)),
            _ => {
                return Err(WorkerError::invalid(
                    "The ZIP archive used an unsupported compression method.",
                ))
            }
        };
        loop {
            let count = decoded
                .read(&mut buffer)
                .map_err(|_| WorkerError::invalid("An archive entry could not be decompressed."))?;
            if count == 0 {
                break;
            }
            actual = actual
                .checked_add(count as u64)
                .ok_or_else(|| WorkerError::limit("An archive byte count overflowed."))?;
            if actual > limits.entry_bytes {
                return Err(WorkerError::limit(
                    "An archive entry exceeded its byte limit while decoding.",
                ));
            }
            if total_uncompressed
                .checked_add(actual)
                .is_none_or(|v| v > limits.uncompressed_bytes)
            {
                return Err(WorkerError::limit(
                    "The archive exceeded its uncompressed-byte limit.",
                ));
            }
            hasher.update(&buffer[..count]);
            crc.update(&buffer[..count]);
            out.write_all(&buffer[..count]).map_err(|_| {
                WorkerError::invalid("An archive output file could not be written.")
            })?;
        }
        out.flush()
            .map_err(|_| WorkerError::invalid("An archive output file could not be flushed."))?;
        if actual != declared || crc.finalize() != metadata.crc32 {
            return Err(WorkerError::invalid(
                "An archive entry did not match its ZIP size or CRC metadata.",
            ));
        }
        let ratio = ceiling_ratio(actual, compressed);
        if ratio > limits.compression_ratio {
            return Err(WorkerError::limit(
                "An archive entry exceeded its compression-ratio limit.",
            ));
        }
        total_uncompressed = total_uncompressed
            .checked_add(actual)
            .ok_or_else(|| WorkerError::limit("The archive byte total overflowed."))?;
        total_compressed = total_compressed
            .checked_add(compressed)
            .ok_or_else(|| WorkerError::limit("The archive byte total overflowed."))?;
        max_entry = max_entry.max(actual);
        max_ratio = max_ratio.max(ratio);
        entries.push(json!({
            "kind": "file", "path": raw_name, "compressedBytes": compressed,
            "uncompressedBytes": actual, "hash": format!("sha256:{}", hex::encode(hasher.finalize())),
        }));
    }
    if entries.is_empty() {
        return Err(WorkerError::invalid(
            "The ZIP archive did not contain any regular files.",
        ));
    }
    max_ratio = max_ratio.max(ceiling_ratio(total_uncompressed, total_compressed));
    if max_ratio > limits.compression_ratio || total_compressed > input_bytes {
        return Err(WorkerError::limit(
            "The archive closure exceeded its aggregate compressed-byte or ratio limit.",
        ));
    }
    entries.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    let closure: Vec<ClosureEntry<'_>> = entries
        .iter()
        .map(|entry| ClosureEntry {
            path: entry["path"].as_str().unwrap(),
            hash: entry["hash"].as_str().unwrap(),
            byte_size: entry["uncompressedBytes"].as_u64().unwrap(),
        })
        .collect();
    let closure_bytes = serde_json::to_vec(&closure)
        .map_err(|_| WorkerError::invalid("The archive closure could not be canonicalized."))?;
    let observed = json!({
        "compressedBytes": input_bytes, "uncompressedBytes": total_uncompressed,
        "entries": entries.len(), "entryBytes": max_entry, "compressionRatio": max_ratio,
    });
    let mut result = success_base(
        request,
        sha256(&closure_bytes),
        total_uncompressed,
        "application/vnd.cbb.quarantine-closure",
        observed,
    );
    result.insert("entries".into(), Value::Array(entries));
    Ok(Value::Object(result))
}

fn register_archive_path(
    path: &str,
    directory: bool,
    paths: &mut BTreeMap<String, (String, bool)>,
) -> Result<(), WorkerError> {
    let logical = if directory {
        path.strip_suffix('/').unwrap_or(path)
    } else {
        path
    };
    let segments: Vec<&str> = logical.split('/').collect();
    let mut current = String::new();
    for (index, segment) in segments.iter().enumerate() {
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(segment);
        let is_last = index + 1 == segments.len();
        let expected_directory = directory || !is_last;
        let alias = current.to_ascii_lowercase();
        if let Some((original, was_directory)) = paths.get(&alias) {
            if original != &current || *was_directory != expected_directory {
                return Err(WorkerError::invalid(
                    "The ZIP archive contained a case alias or file-directory path conflict.",
                ));
            }
            if is_last && !directory {
                return Err(WorkerError::invalid(
                    "The ZIP archive contained a duplicate file path.",
                ));
            }
        } else {
            paths.insert(alias, (current.clone(), expected_directory));
        }
    }
    Ok(())
}

#[derive(Debug)]
struct ZipEntry {
    name: String,
    flags: u16,
    method: u16,
    crc32: u32,
    compressed_bytes: u64,
    uncompressed_bytes: u64,
    local_offset: u64,
    data_ceiling: u64,
    directory: bool,
}

fn read_zip_directory(
    file: &mut (impl Read + Seek),
    file_size: u64,
    entry_limit: u64,
) -> Result<Vec<ZipEntry>, WorkerError> {
    let tail_size = file_size.min(65_557) as usize;
    file.seek(SeekFrom::End(-(tail_size as i64)))
        .map_err(|_| WorkerError::invalid("The ZIP archive could not be searched."))?;
    let mut tail = vec![0; tail_size];
    file.read_exact(&mut tail)
        .map_err(|_| WorkerError::invalid("The ZIP archive was truncated."))?;
    let eocd = tail
        .windows(4)
        .rposition(|bytes| bytes == b"PK\x05\x06")
        .ok_or_else(|| WorkerError::invalid("The ZIP end-of-directory record was missing."))?;
    if eocd + 22 > tail.len() {
        return Err(WorkerError::invalid(
            "The ZIP end-of-directory record was truncated.",
        ));
    }
    let record = &tail[eocd..];
    let disk = le16(record, 4)?;
    let central_disk = le16(record, 6)?;
    let disk_entries = le16(record, 8)? as u64;
    let total_entries = le16(record, 10)? as u64;
    let central_size = le32(record, 12)? as u64;
    let central_offset = le32(record, 16)? as u64;
    let comment_length = le16(record, 20)? as usize;
    if eocd + 22 + comment_length != tail.len()
        || disk != 0
        || central_disk != 0
        || disk_entries != total_entries
    {
        return Err(WorkerError::invalid(
            "Only single-disk ZIP archives with a canonical end record are accepted.",
        ));
    }
    if total_entries == 0xffff || central_size == 0xffff_ffff || central_offset == 0xffff_ffff {
        return Err(WorkerError::invalid(
            "ZIP64 archives are not accepted by this bounded worker.",
        ));
    }
    if total_entries > entry_limit {
        return Err(WorkerError::limit(
            "The archive contained more central-directory entries than authorized.",
        ));
    }
    let eocd_offset = file_size - tail_size as u64 + eocd as u64;
    if central_offset.checked_add(central_size) != Some(eocd_offset) {
        return Err(WorkerError::invalid(
            "The ZIP central-directory bounds were invalid.",
        ));
    }
    file.seek(SeekFrom::Start(central_offset))
        .map_err(|_| WorkerError::invalid("The ZIP central directory could not be opened."))?;
    let mut entries = Vec::with_capacity(total_entries as usize);
    let mut consumed = 0u64;
    for _ in 0..total_entries {
        let mut fixed = [0u8; 46];
        file.read_exact(&mut fixed)
            .map_err(|_| WorkerError::invalid("A ZIP central-directory record was truncated."))?;
        consumed += 46;
        if &fixed[..4] != b"PK\x01\x02" {
            return Err(WorkerError::invalid(
                "A ZIP central-directory signature was invalid.",
            ));
        }
        let host = fixed[5];
        let flags = le16(&fixed, 8)?;
        let method = le16(&fixed, 10)?;
        let crc32 = le32(&fixed, 16)?;
        let compressed = le32(&fixed, 20)? as u64;
        let uncompressed = le32(&fixed, 24)? as u64;
        let name_len = le16(&fixed, 28)? as usize;
        let extra_len = le16(&fixed, 30)? as usize;
        let comment_len = le16(&fixed, 32)? as usize;
        let start_disk = le16(&fixed, 34)?;
        let external = le32(&fixed, 38)?;
        let local_offset = le32(&fixed, 42)? as u64;
        if flags & !0x080e != 0
            || flags & 1 != 0
            || start_disk != 0
            || !matches!(method, 0 | 8)
            || compressed == 0xffff_ffff
            || uncompressed == 0xffff_ffff
            || local_offset == 0xffff_ffff
            || name_len == 0
            || name_len > 1024
        {
            return Err(WorkerError::invalid(
                "A ZIP entry used an unsupported or unsafe feature.",
            ));
        }
        let variable = name_len
            .checked_add(extra_len)
            .and_then(|v| v.checked_add(comment_len))
            .ok_or_else(|| WorkerError::invalid("A ZIP central-directory length overflowed."))?;
        consumed = consumed
            .checked_add(variable as u64)
            .ok_or_else(|| WorkerError::invalid("The ZIP central-directory size overflowed."))?;
        if consumed > central_size {
            return Err(WorkerError::invalid(
                "A ZIP central-directory record exceeded its declared bounds.",
            ));
        }
        let mut name = vec![0; name_len];
        file.read_exact(&mut name)
            .map_err(|_| WorkerError::invalid("A ZIP entry name was truncated."))?;
        file.seek(SeekFrom::Current((extra_len + comment_len) as i64))
            .map_err(|_| WorkerError::invalid("A ZIP central-directory record was malformed."))?;
        if !name.is_ascii() {
            return Err(WorkerError::invalid(
                "ZIP entry names must be safe ASCII in this worker build.",
            ));
        }
        let name = String::from_utf8(name)
            .map_err(|_| WorkerError::invalid("A ZIP entry name was not UTF-8."))?;
        let directory = name.ends_with('/');
        if directory && (compressed != 0 || uncompressed != 0) {
            return Err(WorkerError::invalid(
                "A ZIP directory entry declared file content.",
            ));
        }
        if host == 3 {
            let kind = (external >> 16) & 0o170000;
            if directory {
                if kind != 0 && kind != 0o040000 {
                    return Err(WorkerError::invalid(
                        "A ZIP directory had unsafe Unix metadata.",
                    ));
                }
            } else if kind != 0 && kind != 0o100000 {
                return Err(WorkerError::invalid(
                    "The ZIP archive contained a non-regular Unix entry.",
                ));
            }
        } else if !directory && external & 0x10 != 0 {
            return Err(WorkerError::invalid(
                "A ZIP file entry had directory metadata.",
            ));
        }
        entries.push(ZipEntry {
            name,
            flags,
            method,
            crc32,
            compressed_bytes: compressed,
            uncompressed_bytes: uncompressed,
            local_offset,
            data_ceiling: central_offset,
            directory,
        });
    }
    if consumed != central_size {
        return Err(WorkerError::invalid(
            "The ZIP central-directory size was inconsistent.",
        ));
    }
    Ok(entries)
}

fn read_local_header(file: &mut (impl Read + Seek), entry: &ZipEntry) -> Result<u64, WorkerError> {
    file.seek(SeekFrom::Start(entry.local_offset))
        .map_err(|_| WorkerError::invalid("A ZIP local-header offset was invalid."))?;
    let mut fixed = [0u8; 30];
    file.read_exact(&mut fixed)
        .map_err(|_| WorkerError::invalid("A ZIP local header was truncated."))?;
    if &fixed[..4] != b"PK\x03\x04"
        || le16(&fixed, 6)? != entry.flags
        || le16(&fixed, 8)? != entry.method
    {
        return Err(WorkerError::invalid(
            "A ZIP local header did not match the central directory.",
        ));
    }
    let name_len = le16(&fixed, 26)? as usize;
    let extra_len = le16(&fixed, 28)? as usize;
    if name_len != entry.name.len() {
        return Err(WorkerError::invalid(
            "A ZIP local entry name length was inconsistent.",
        ));
    }
    let mut name = vec![0; name_len];
    file.read_exact(&mut name)
        .map_err(|_| WorkerError::invalid("A ZIP local entry name was truncated."))?;
    if name != entry.name.as_bytes() {
        return Err(WorkerError::invalid(
            "A ZIP local entry name did not match the central directory.",
        ));
    }
    let data_start = entry
        .local_offset
        .checked_add(30)
        .and_then(|v| v.checked_add(name_len as u64))
        .and_then(|v| v.checked_add(extra_len as u64))
        .ok_or_else(|| WorkerError::invalid("A ZIP local-header length overflowed."))?;
    if data_start
        .checked_add(entry.compressed_bytes)
        .is_none_or(|end| end > entry.data_ceiling)
    {
        return Err(WorkerError::invalid(
            "A ZIP entry payload overlapped the central directory.",
        ));
    }
    if entry.flags & 8 == 0
        && (le32(&fixed, 14)? != entry.crc32
            || u64::from(le32(&fixed, 18)?) != entry.compressed_bytes
            || u64::from(le32(&fixed, 22)?) != entry.uncompressed_bytes)
    {
        return Err(WorkerError::invalid(
            "A ZIP local header did not agree with central size or CRC metadata.",
        ));
    }
    Ok(data_start)
}

fn le16(bytes: &[u8], offset: usize) -> Result<u16, WorkerError> {
    bytes
        .get(offset..offset + 2)
        .and_then(|v| v.try_into().ok())
        .map(u16::from_le_bytes)
        .ok_or_else(|| WorkerError::invalid("A ZIP integer was truncated."))
}

fn le32(bytes: &[u8], offset: usize) -> Result<u32, WorkerError> {
    bytes
        .get(offset..offset + 4)
        .and_then(|v| v.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or_else(|| WorkerError::invalid("A ZIP integer was truncated."))
}

struct Crc32(u32);

impl Crc32 {
    fn new() -> Self {
        Self(0xffff_ffff)
    }
    fn update(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            let mut value = self.0 ^ u32::from(byte);
            for _ in 0..8 {
                value = if value & 1 != 0 {
                    (value >> 1) ^ 0xedb8_8320
                } else {
                    value >> 1
                };
            }
            self.0 = value;
        }
    }
    fn finalize(self) -> u32 {
        !self.0
    }
}

fn ceiling_ratio(uncompressed: u64, compressed: u64) -> u64 {
    if uncompressed == 0 {
        1
    } else if compressed == 0 {
        u64::MAX
    } else {
        (uncompressed - 1)
            .checked_div(compressed)
            .and_then(|ratio| ratio.checked_add(1))
            .unwrap_or(u64::MAX)
    }
}

fn safe_archive_path(path: &str) -> bool {
    if path.is_empty()
        || path.len() > 1024
        || !path.is_ascii()
        || path.starts_with('/')
        || path.contains(['\\', '\0', ':'])
    {
        return false;
    }
    path.split('/').all(|segment| {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.ends_with(['.', ' '])
            || segment.bytes().any(|b| b < 0x20 || b == 0x7f)
        {
            return false;
        }
        let lower = segment.to_ascii_lowercase();
        let base = lower.split('.').next().unwrap_or("");
        !matches!(base, "con" | "prn" | "aux" | "nul")
            && !(base.len() == 4
                && (base.starts_with("com") || base.starts_with("lpt"))
                && matches!(base.as_bytes()[3], b'1'..=b'9'))
    })
}

fn sanitize_svg(request: &Request, input: &Path, output: &Path) -> Result<Value, WorkerError> {
    use quick_xml::events::{BytesEnd, BytesStart, Event};
    use quick_xml::{Reader, Writer};
    let limits: SvgLimits = decode_limits(&request.limits)?;
    let bytes = bounded_read(input, limits.input_bytes)?;
    let mut reader = Reader::from_reader(bytes.as_slice());
    reader.config_mut().trim_text(true);
    reader.config_mut().check_end_names = true;
    let mut writer = Writer::new(Vec::new());
    let mut stack: Vec<String> = Vec::new();
    let mut nodes = 0u64;
    let mut path_commands = 0u64;
    let mut saw_root = false;
    loop {
        let event = reader
            .read_event()
            .map_err(|_| WorkerError::invalid("The SVG was not well-formed XML."))?;
        match event {
            Event::Start(ref start) | Event::Empty(ref start) => {
                let empty = matches!(&event, Event::Empty(_));
                let name = std::str::from_utf8(start.name().as_ref())
                    .map_err(|_| WorkerError::invalid("The SVG used a non-UTF-8 element name."))?
                    .to_owned();
                if !allowed_svg_element(&name) {
                    return Err(WorkerError::invalid(
                        "The SVG contained a disallowed element.",
                    ));
                }
                if !saw_root {
                    if name != "svg" {
                        return Err(WorkerError::invalid("The SVG root element was not svg."));
                    }
                    saw_root = true;
                } else if stack.is_empty() {
                    return Err(WorkerError::invalid(
                        "The SVG contained multiple root elements.",
                    ));
                }
                nodes += 1;
                if nodes > limits.xml_nodes {
                    return Err(WorkerError::limit("The SVG exceeded its XML-node limit."));
                }
                if stack.len() >= 64 {
                    return Err(WorkerError::limit(
                        "The SVG exceeded its nesting-depth limit.",
                    ));
                }
                let mut attributes: BTreeMap<String, String> = BTreeMap::new();
                for attr in start.attributes() {
                    let attr = attr.map_err(|_| {
                        WorkerError::invalid("The SVG contained a malformed attribute.")
                    })?;
                    let key = std::str::from_utf8(attr.key.as_ref())
                        .map_err(|_| {
                            WorkerError::invalid("The SVG used a non-UTF-8 attribute name.")
                        })?
                        .to_owned();
                    if !allowed_svg_attribute(&key, &name, stack.is_empty()) {
                        return Err(WorkerError::invalid(
                            "The SVG contained a disallowed attribute.",
                        ));
                    }
                    let value = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|_| {
                            WorkerError::invalid("The SVG contained an invalid attribute value.")
                        })?
                        .into_owned();
                    if value.chars().any(|c| c.is_control())
                        || value.to_ascii_lowercase().contains("url(")
                        || value.len() > 65_536
                    {
                        return Err(WorkerError::invalid(
                            "The SVG contained an unsafe attribute value.",
                        ));
                    }
                    validate_svg_attribute_value(&key, &value, &name)?;
                    if key == "d" {
                        path_commands = path_commands.saturating_add(
                            value
                                .bytes()
                                .filter(|b| {
                                    matches!(
                                        b,
                                        b'M' | b'm'
                                            | b'Z'
                                            | b'z'
                                            | b'L'
                                            | b'l'
                                            | b'H'
                                            | b'h'
                                            | b'V'
                                            | b'v'
                                            | b'C'
                                            | b'c'
                                            | b'S'
                                            | b's'
                                            | b'Q'
                                            | b'q'
                                            | b'T'
                                            | b't'
                                            | b'A'
                                            | b'a'
                                    )
                                })
                                .count() as u64,
                        );
                        if path_commands > limits.path_commands {
                            return Err(WorkerError::limit(
                                "The SVG exceeded its path-command limit.",
                            ));
                        }
                    }
                    if attributes.insert(key, value).is_some() {
                        return Err(WorkerError::invalid(
                            "The SVG contained duplicate attributes.",
                        ));
                    }
                }
                let mut clean = BytesStart::new(name.as_str());
                for (key, value) in &attributes {
                    clean.push_attribute((key.as_str(), value.as_str()));
                }
                if empty {
                    writer
                        .write_event(Event::Empty(clean))
                        .map_err(|_| WorkerError::invalid("The SVG could not be canonicalized."))?;
                } else {
                    writer
                        .write_event(Event::Start(clean))
                        .map_err(|_| WorkerError::invalid("The SVG could not be canonicalized."))?;
                    stack.push(name);
                }
            }
            Event::End(end) => {
                let name = std::str::from_utf8(end.name().as_ref())
                    .map_err(|_| WorkerError::invalid("The SVG used a non-UTF-8 end tag."))?
                    .to_owned();
                let open = stack.pop().ok_or_else(|| {
                    WorkerError::invalid("The SVG contained an unmatched end tag.")
                })?;
                if open != name {
                    return Err(WorkerError::invalid("The SVG contained mismatched tags."));
                }
                writer
                    .write_event(Event::End(BytesEnd::new(name.as_str())))
                    .map_err(|_| WorkerError::invalid("The SVG could not be canonicalized."))?;
            }
            Event::Text(text) => {
                if !text.as_ref().iter().all(|b| b.is_ascii_whitespace()) {
                    return Err(WorkerError::invalid(
                        "Text nodes are not accepted in quarantined SVG artwork.",
                    ));
                }
            }
            Event::Eof => break,
            Event::Decl(_) | Event::Comment(_) => {}
            Event::DocType(_) | Event::PI(_) | Event::CData(_) | Event::GeneralRef(_) => {
                return Err(WorkerError::invalid(
                    "The SVG contained an unsafe XML construct.",
                ));
            }
        }
    }
    if !saw_root || !stack.is_empty() {
        return Err(WorkerError::invalid("The SVG document was incomplete."));
    }
    let canonical = writer.into_inner();
    write_output(output, &canonical, limits.output_bytes)?;
    let observed =
        json!({ "inputBytes": bytes.len(), "xmlNodes": nodes, "pathCommands": path_commands });
    Ok(Value::Object(success_base(
        request,
        sha256(&canonical),
        canonical.len() as u64,
        "image/svg+xml",
        observed,
    )))
}

fn allowed_svg_element(name: &str) -> bool {
    matches!(
        name,
        "svg" | "g" | "path" | "rect" | "circle" | "ellipse" | "line" | "polyline" | "polygon"
    )
}

fn allowed_svg_attribute(key: &str, element: &str, root: bool) -> bool {
    if key == "xmlns" {
        return root && element == "svg";
    }
    matches!(
        key,
        "viewBox"
            | "width"
            | "height"
            | "x"
            | "y"
            | "x1"
            | "x2"
            | "y1"
            | "y2"
            | "cx"
            | "cy"
            | "r"
            | "rx"
            | "ry"
            | "d"
            | "points"
            | "fill"
            | "fill-opacity"
            | "stroke"
            | "stroke-width"
            | "stroke-opacity"
            | "opacity"
            | "transform"
            | "fill-rule"
            | "stroke-linecap"
            | "stroke-linejoin"
    )
}

fn validate_svg_attribute_value(key: &str, value: &str, element: &str) -> Result<(), WorkerError> {
    let invalid =
        || WorkerError::invalid("The SVG contained an invalid or unbounded attribute value.");
    match key {
        "xmlns" if value != "http://www.w3.org/2000/svg" => return Err(invalid()),
        "xmlns" => {}
        "viewBox" => {
            let numbers = svg_number_list(value, false)?;
            if numbers.len() != 4 || numbers[2] <= 0.0 || numbers[3] <= 0.0 {
                return Err(invalid());
            }
        }
        "width" | "height" | "r" | "rx" | "ry" | "stroke-width" => {
            let number = svg_single_number(value, true)?;
            if number < 0.0 {
                return Err(invalid());
            }
        }
        "x" | "y" | "x1" | "x2" | "y1" | "y2" | "cx" | "cy" => {
            svg_single_number(value, true)?;
        }
        "opacity" | "fill-opacity" | "stroke-opacity" => {
            let number = svg_single_number(value, false)?;
            if !(0.0..=1.0).contains(&number) {
                return Err(invalid());
            }
        }
        "fill" | "stroke" => {
            let valid_keyword = matches!(value, "none" | "currentColor" | "transparent")
                || (!value.is_empty()
                    && value.len() <= 32
                    && value.bytes().all(|b| b.is_ascii_alphabetic()))
                || (matches!(value.len(), 4 | 5 | 7 | 9)
                    && value.starts_with('#')
                    && value[1..].bytes().all(|b| b.is_ascii_hexdigit()));
            if !valid_keyword {
                return Err(invalid());
            }
        }
        "fill-rule" if !matches!(value, "nonzero" | "evenodd") => return Err(invalid()),
        "fill-rule" => {}
        "stroke-linecap" if !matches!(value, "butt" | "round" | "square") => return Err(invalid()),
        "stroke-linecap" => {}
        "stroke-linejoin" if !matches!(value, "miter" | "round" | "bevel") => return Err(invalid()),
        "stroke-linejoin" => {}
        "d" => {
            if element != "path" || value.is_empty() {
                return Err(invalid());
            }
            svg_path_data(value)?;
        }
        "points" => {
            if !matches!(element, "polyline" | "polygon") {
                return Err(invalid());
            }
            let numbers = svg_number_list(value, false)?;
            let minimum = if element == "polygon" { 6 } else { 4 };
            if numbers.len() < minimum || numbers.len() % 2 != 0 {
                return Err(invalid());
            }
        }
        "transform" => svg_transform(value)?,
        _ => {}
    }
    Ok(())
}

fn svg_single_number(value: &str, allow_percent: bool) -> Result<f64, WorkerError> {
    let trimmed = value.trim();
    let number = if allow_percent {
        trimmed.strip_suffix('%').unwrap_or(trimmed)
    } else {
        trimmed
    };
    let parsed = number
        .parse::<f64>()
        .map_err(|_| WorkerError::invalid("The SVG contained an invalid number."))?;
    if !parsed.is_finite() || parsed.abs() > 1_000_000.0 {
        return Err(WorkerError::limit(
            "An SVG numeric magnitude exceeded its limit.",
        ));
    }
    Ok(parsed)
}

fn svg_number_list(value: &str, allow_percent: bool) -> Result<Vec<f64>, WorkerError> {
    let mut numbers = Vec::new();
    for token in value
        .split(|c: char| c.is_ascii_whitespace() || c == ',')
        .filter(|v| !v.is_empty())
    {
        numbers.push(svg_single_number(token, allow_percent)?);
        if numbers.len() > 1_000_000 {
            return Err(WorkerError::limit(
                "An SVG numeric list exceeded its token limit.",
            ));
        }
    }
    if numbers.is_empty() {
        return Err(WorkerError::invalid(
            "The SVG contained an empty numeric list.",
        ));
    }
    Ok(numbers)
}

fn svg_path_data(value: &str) -> Result<(), WorkerError> {
    let bytes = value.as_bytes();
    let mut index = 0usize;
    let mut saw_command = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte.is_ascii_whitespace() || byte == b',' {
            index += 1;
            continue;
        }
        if matches!(
            byte,
            b'M' | b'm'
                | b'Z'
                | b'z'
                | b'L'
                | b'l'
                | b'H'
                | b'h'
                | b'V'
                | b'v'
                | b'C'
                | b'c'
                | b'S'
                | b's'
                | b'Q'
                | b'q'
                | b'T'
                | b't'
                | b'A'
                | b'a'
        ) {
            saw_command = true;
            index += 1;
            continue;
        }
        index = svg_number_at(value, index)?;
    }
    if !saw_command {
        return Err(WorkerError::invalid("The SVG path contained no commands."));
    }
    Ok(())
}

fn svg_number_at(value: &str, start: usize) -> Result<usize, WorkerError> {
    let bytes = value.as_bytes();
    let mut index = start;
    if matches!(bytes.get(index), Some(b'+') | Some(b'-')) {
        index += 1;
    }
    let integer_start = index;
    while matches!(bytes.get(index), Some(b'0'..=b'9')) {
        index += 1;
    }
    let mut digits = index > integer_start;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let fraction_start = index;
        while matches!(bytes.get(index), Some(b'0'..=b'9')) {
            index += 1;
        }
        digits |= index > fraction_start;
    }
    if !digits {
        return Err(WorkerError::invalid(
            "The SVG contained malformed numeric syntax.",
        ));
    }
    if matches!(bytes.get(index), Some(b'e') | Some(b'E')) {
        index += 1;
        if matches!(bytes.get(index), Some(b'+') | Some(b'-')) {
            index += 1;
        }
        let exponent_start = index;
        while matches!(bytes.get(index), Some(b'0'..=b'9')) {
            index += 1;
        }
        if index == exponent_start {
            return Err(WorkerError::invalid(
                "The SVG contained a malformed exponent.",
            ));
        }
    }
    svg_single_number(&value[start..index], false)?;
    Ok(index)
}

fn svg_transform(value: &str) -> Result<(), WorkerError> {
    let mut rest = value.trim();
    let mut transforms = 0usize;
    while !rest.is_empty() {
        let identifier_end = rest
            .find(|c: char| !c.is_ascii_alphabetic())
            .unwrap_or(rest.len());
        let identifier = &rest[..identifier_end];
        if !matches!(
            identifier,
            "matrix" | "translate" | "scale" | "rotate" | "skewX" | "skewY"
        ) {
            return Err(WorkerError::invalid(
                "The SVG contained an unsupported transform.",
            ));
        }
        rest = rest[identifier_end..].trim_start();
        if !rest.starts_with('(') {
            return Err(WorkerError::invalid(
                "The SVG transform syntax was malformed.",
            ));
        }
        let close = rest
            .find(')')
            .ok_or_else(|| WorkerError::invalid("The SVG transform was unterminated."))?;
        if rest[1..close].contains('(') {
            return Err(WorkerError::invalid(
                "Nested SVG transforms are not accepted.",
            ));
        }
        let numbers = svg_number_list(&rest[1..close], false)?;
        let expected = match identifier {
            "matrix" => 6..=6,
            "translate" | "scale" => 1..=2,
            "rotate" => 1..=3,
            _ => 1..=1,
        };
        if !expected.contains(&numbers.len()) {
            return Err(WorkerError::invalid(
                "The SVG transform had an invalid argument count.",
            ));
        }
        rest = rest[close + 1..].trim_start_matches(|c: char| c.is_ascii_whitespace() || c == ',');
        transforms += 1;
        if transforms > 64 {
            return Err(WorkerError::limit("The SVG contained too many transforms."));
        }
    }
    Ok(())
}

fn canonicalize_raster(
    request: &Request,
    input: &Path,
    output: &Path,
) -> Result<Value, WorkerError> {
    let limits: RasterLimits = decode_limits(&request.limits)?;
    let bytes = bounded_read(input, limits.input_bytes)?;
    let (width, height, rgba) = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        decode_png(&bytes, limits)?
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        decode_jpeg(&bytes, limits)?
    } else {
        return Err(WorkerError::invalid(
            "Only PNG and JPEG raster inputs are accepted.",
        ));
    };
    let mut canonical = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut canonical, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Best);
        encoder.set_filter(png::FilterType::Paeth);
        let mut writer = encoder.write_header().map_err(|_| {
            WorkerError::invalid("The raster could not be encoded as canonical PNG.")
        })?;
        writer.write_image_data(&rgba).map_err(|_| {
            WorkerError::invalid("The raster could not be encoded as canonical PNG.")
        })?;
    }
    write_output(output, &canonical, limits.output_bytes)?;
    let observed = json!({ "inputBytes": bytes.len(), "decodedPixels": u64::from(width) * u64::from(height), "width": width, "height": height });
    Ok(Value::Object(success_base(
        request,
        sha256(&canonical),
        canonical.len() as u64,
        "image/png",
        observed,
    )))
}

fn checked_raster_size(
    width: u32,
    height: u32,
    limits: RasterLimits,
) -> Result<usize, WorkerError> {
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| WorkerError::limit("The raster dimensions overflowed."))?;
    if width == 0
        || height == 0
        || u64::from(width) > limits.width
        || u64::from(height) > limits.height
        || pixels > limits.decoded_pixels
    {
        return Err(WorkerError::limit(
            "The decoded raster dimensions exceeded their limits.",
        ));
    }
    usize::try_from(
        pixels
            .checked_mul(4)
            .ok_or_else(|| WorkerError::limit("The raster allocation overflowed."))?,
    )
    .map_err(|_| WorkerError::limit("The raster allocation exceeded this platform."))
}

fn decode_png(bytes: &[u8], limits: RasterLimits) -> Result<(u32, u32, Vec<u8>), WorkerError> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_limits(png::Limits {
        bytes: usize::try_from(limits.decoded_pixels.saturating_mul(8).min(1_000_000_000))
            .unwrap_or(1_000_000_000),
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| WorkerError::invalid("The PNG input was not structurally valid."))?;
    let width = reader.info().width;
    let height = reader.info().height;
    let rgba_size = checked_raster_size(width, height, limits)?;
    if reader.info().animation_control.is_some() {
        return Err(WorkerError::invalid(
            "Animated PNG inputs are not accepted.",
        ));
    }
    let mut decoded = vec![0; reader.output_buffer_size()];
    let frame = reader
        .next_frame(&mut decoded)
        .map_err(|_| WorkerError::invalid("The PNG input could not be decoded."))?;
    let source = &decoded[..frame.buffer_size()];
    let mut rgba = Vec::with_capacity(rgba_size);
    match frame.color_type {
        png::ColorType::Rgba => rgba.extend_from_slice(source),
        png::ColorType::Rgb => {
            for pixel in source.chunks_exact(3) {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
        }
        png::ColorType::Grayscale => {
            for &v in source {
                rgba.extend_from_slice(&[v, v, v, 255]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for pixel in source.chunks_exact(2) {
                rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]]);
            }
        }
        png::ColorType::Indexed => {
            return Err(WorkerError::invalid(
                "The PNG palette could not be expanded safely.",
            ))
        }
    }
    if rgba.len() != rgba_size {
        return Err(WorkerError::invalid(
            "The decoded PNG byte count was inconsistent.",
        ));
    }
    Ok((width, height, rgba))
}

fn decode_jpeg(bytes: &[u8], limits: RasterLimits) -> Result<(u32, u32, Vec<u8>), WorkerError> {
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(bytes));
    decoder.set_max_decoding_buffer_size(
        usize::try_from(limits.decoded_pixels.saturating_mul(8).min(1_000_000_000))
            .unwrap_or(1_000_000_000),
    );
    decoder
        .read_info()
        .map_err(|_| WorkerError::invalid("The JPEG input was not structurally valid."))?;
    let info = decoder
        .info()
        .ok_or_else(|| WorkerError::invalid("The JPEG input did not contain image metadata."))?;
    let width = u32::from(info.width);
    let height = u32::from(info.height);
    let rgba_size = checked_raster_size(width, height, limits)?;
    let decoded = decoder
        .decode()
        .map_err(|_| WorkerError::invalid("The JPEG input could not be decoded."))?;
    let mut rgba = Vec::with_capacity(rgba_size);
    match info.pixel_format {
        jpeg_decoder::PixelFormat::L8 => {
            for v in decoded {
                rgba.extend_from_slice(&[v, v, v, 255]);
            }
        }
        jpeg_decoder::PixelFormat::RGB24 => {
            for pixel in decoded.chunks_exact(3) {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
        }
        jpeg_decoder::PixelFormat::L16 => {
            for pixel in decoded.chunks_exact(2) {
                let v = pixel[0];
                rgba.extend_from_slice(&[v, v, v, 255]);
            }
        }
        jpeg_decoder::PixelFormat::CMYK32 => {
            return Err(WorkerError::invalid(
                "CMYK JPEG inputs require a pinned color-management closure.",
            ))
        }
    }
    if rgba.len() != rgba_size {
        return Err(WorkerError::invalid(
            "The decoded JPEG byte count was inconsistent.",
        ));
    }
    Ok((width, height, rgba))
}

fn inspect_font(request: &Request, input: &Path, output: &Path) -> Result<Value, WorkerError> {
    use ttf_parser::{name_id, Permissions, Style};
    let limits: FontLimits = decode_limits(&request.limits)?;
    let bytes = bounded_read(input, limits.input_bytes)?;
    let signature = bytes
        .get(..4)
        .ok_or_else(|| WorkerError::invalid("The font input was truncated."))?;
    let media_type = match signature {
        b"OTTO" => "font/otf",
        [0x00, 0x01, 0x00, 0x00] | b"true" | b"ttcf" => "font/ttf",
        b"wOFF" | b"wOF2" => {
            return Err(WorkerError::unavailable(
                "WOFF fonts require a pinned static decompression closure.",
            ))
        }
        _ => {
            return Err(WorkerError::invalid(
                "Only structurally valid OpenType or TrueType fonts are accepted.",
            ))
        }
    };
    let face_count = ttf_parser::fonts_in_collection(&bytes).unwrap_or(1);
    if face_count == 0 || face_count > 256 {
        return Err(WorkerError::limit(
            "The font collection contained an invalid number of faces.",
        ));
    }
    let mut faces = Vec::new();
    let mut glyphs = 0u64;
    let mut coverage = vec![false; 0x11_0000];
    for index in 0..face_count {
        let face = ttf_parser::Face::parse(&bytes, index).map_err(|_| {
            WorkerError::invalid("A font face could not be parsed by the Typst-compatible parser.")
        })?;
        validate_font_tables(&face)?;
        collect_unicode_coverage(&face, &mut coverage)?;
        let family = font_name(&face, name_id::TYPOGRAPHIC_FAMILY)
            .or_else(|| font_name(&face, name_id::FAMILY))
            .ok_or_else(|| {
                WorkerError::invalid("A font face did not contain a safe family name.")
            })?;
        let postscript = font_name(&face, name_id::POST_SCRIPT_NAME).ok_or_else(|| {
            WorkerError::invalid("A font face did not contain a safe PostScript name.")
        })?;
        let weight = face.weight().to_number().clamp(100, 900);
        let style = match face.style() {
            Style::Normal => "normal",
            Style::Italic => "italic",
            Style::Oblique => "oblique",
        };
        let stretch = [0.0, 0.5, 0.625, 0.75, 0.875, 1.0, 1.125, 1.25, 1.5, 2.0]
            [face.width().to_number() as usize];
        let permissions = face.permissions();
        let embedding = !matches!(permissions, Some(Permissions::Restricted))
            && face.is_outline_embedding_allowed();
        let subsetting = embedding && face.is_subsetting_allowed();
        let mut value = json!({
            "faceIndex": index, "familyName": family, "postScriptName": postscript,
            "weight": weight, "style": style, "stretch": stretch,
            "pdfEmbeddingPermitted": embedding, "pdfSubsettingPermitted": subsetting,
        });
        let mut axes = Map::new();
        for axis in face.variation_axes() {
            let tag = axis.tag.to_bytes();
            if tag.iter().all(|b| matches!(b, 0x20..=0x7e)) {
                axes.insert(
                    String::from_utf8_lossy(&tag).into_owned(),
                    json!(axis.def_value),
                );
            }
        }
        if !axes.is_empty() {
            value
                .as_object_mut()
                .unwrap()
                .insert("variableAxisCoordinates".into(), Value::Object(axes));
        }
        glyphs += u64::from(face.number_of_glyphs());
        faces.push(value);
    }
    write_output(output, &bytes, limits.output_bytes)?;
    let observed = json!({ "inputBytes": bytes.len() });
    let mut result = success_base(
        request,
        sha256(&bytes),
        bytes.len() as u64,
        media_type,
        observed,
    );
    result.insert("faces".into(), Value::Array(faces));
    result.insert("typstLoadable".into(), json!(true));
    let codepoints = coverage.iter().filter(|covered| **covered).count();
    let basic_latin = coverage[0x20..=0x7e]
        .iter()
        .filter(|covered| **covered)
        .count();
    let latin = coverage[..=0x024f]
        .iter()
        .filter(|covered| **covered)
        .count();
    let greek = coverage[0x0370..=0x03ff]
        .iter()
        .filter(|covered| **covered)
        .count();
    let cyrillic = coverage[0x0400..=0x052f]
        .iter()
        .filter(|covered| **covered)
        .count();
    let arabic = coverage[0x0600..=0x06ff]
        .iter()
        .filter(|covered| **covered)
        .count();
    let cjk = coverage[0x3400..=0x9fff]
        .iter()
        .filter(|covered| **covered)
        .count();
    result.insert(
        "unicodeCoverageSummary".into(),
        json!(format!("codepoints={codepoints};basicLatin={basic_latin};latin={latin};greek={greek};cyrillic={cyrillic};arabic={arabic};cjk={cjk};faces={face_count};glyphs={glyphs};parser=ttf-parser-0.25.1")),
    );
    Ok(Value::Object(result))
}

fn validate_font_tables(face: &ttf_parser::Face<'_>) -> Result<(), WorkerError> {
    let tables = face.tables();
    if face.number_of_glyphs() == 0
        || tables.hmtx.is_none()
        || tables.cmap.is_none()
        || (tables.glyf.is_none() && tables.cff.is_none() && tables.cff2.is_none())
    {
        return Err(WorkerError::invalid(
            "The font lacked required scalable metrics, outlines, or Unicode mapping tables.",
        ));
    }
    let raw = face.raw_face();
    if raw.table_records.is_empty() || raw.table_records.len() > 256 {
        return Err(WorkerError::limit(
            "The font table directory exceeded its structural limit.",
        ));
    }
    let mut tags = HashSet::new();
    let mut ranges = Vec::new();
    for record in raw.table_records {
        if !tags.insert(record.tag) {
            return Err(WorkerError::invalid(
                "The font contained duplicate table tags.",
            ));
        }
        let start = record.offset as usize;
        let end = start
            .checked_add(record.length as usize)
            .ok_or_else(|| WorkerError::invalid("A font table range overflowed."))?;
        let table = raw
            .data
            .get(start..end)
            .ok_or_else(|| WorkerError::invalid("A font table exceeded the file bounds."))?;
        let head = record.tag.to_bytes() == *b"head";
        if sfnt_checksum(table, head) != record.check_sum {
            return Err(WorkerError::invalid("A font table checksum was invalid."));
        }
        ranges.push((start, end));
    }
    ranges.sort_unstable();
    if ranges.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err(WorkerError::invalid(
            "Font tables overlapped in the source file.",
        ));
    }
    Ok(())
}

fn sfnt_checksum(table: &[u8], head: bool) -> u32 {
    let mut sum = 0u32;
    for offset in (0..table.len()).step_by(4) {
        let mut word = [0u8; 4];
        let count = (table.len() - offset).min(4);
        word[..count].copy_from_slice(&table[offset..offset + count]);
        if head {
            for (index, byte) in word.iter_mut().enumerate() {
                if (8..12).contains(&(offset + index)) {
                    *byte = 0;
                }
            }
        }
        sum = sum.wrapping_add(u32::from_be_bytes(word));
    }
    sum
}

fn collect_unicode_coverage(
    face: &ttf_parser::Face<'_>,
    coverage: &mut [bool],
) -> Result<(), WorkerError> {
    let cmap = face
        .tables()
        .cmap
        .ok_or_else(|| WorkerError::invalid("The font did not contain a parsed cmap table."))?;
    let glyph_count = face.number_of_glyphs();
    let mut unicode_subtables = 0usize;
    let mut mapped = 0usize;
    for subtable in cmap.subtables {
        if !subtable.is_unicode() {
            continue;
        }
        unicode_subtables += 1;
        subtable.codepoints(|codepoint| {
            if let Some(slot) = coverage.get_mut(codepoint as usize) {
                if subtable
                    .glyph_index(codepoint)
                    .is_some_and(|glyph| glyph.0 < glyph_count)
                {
                    if !*slot {
                        mapped += 1;
                    }
                    *slot = true;
                }
            }
        });
    }
    if unicode_subtables == 0 || mapped == 0 {
        return Err(WorkerError::invalid(
            "The font did not contain a usable Unicode cmap subtable.",
        ));
    }
    Ok(())
}

fn font_name(face: &ttf_parser::Face<'_>, id: u16) -> Option<String> {
    face.names()
        .into_iter()
        .filter(|name| name.name_id == id)
        .filter_map(|name| name.to_string())
        .map(|name| name.trim().to_owned())
        .find(|name| !name.is_empty() && name.len() <= 512 && !name.chars().any(|c| c.is_control()))
}

fn flatten_pdf(request: &Request, input: &Path) -> Result<Value, WorkerError> {
    let limits: PdfLimits = decode_limits(&request.limits)?;
    let _ = bounded_read(input, limits.input_bytes)?;
    Err(WorkerError::unavailable("PDF flattening requires a pinned statically linked renderer that is not present in this worker build."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "cbb-quarantine-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    fn handle(byte: char) -> String {
        format!("qh:{}", byte.to_string().repeat(64))
    }

    fn request(operation: &str, limits: Value) -> Value {
        json!({ "version": 1, "requestId": "22222222-2222-4222-8222-222222222222", "operation": operation,
            "input": handle('a'), "output": handle('b'), "limits": limits })
    }

    #[test]
    fn sanitizes_svg_and_rejects_external_references() {
        let root = root("svg");
        let input = root.join("input");
        let output = root.join("output");
        fs::write(&input, b"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><!--x--><path fill='red' d='M0 0L1 1Z'/></svg>").unwrap();
        fs::write(&output, b"").unwrap();
        let req = request(
            "sanitizeSvg",
            json!({ "inputBytes": 1024, "outputBytes": 1024, "xmlNodes": 10, "pathCommands": 10 }),
        );
        let result = process_json(&serde_json::to_vec(&req).unwrap(), &input, &output);
        assert_eq!(result["status"], "succeeded");
        assert_eq!(fs::read_to_string(&output).unwrap(), "<svg viewBox=\"0 0 10 10\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0L1 1Z\" fill=\"red\"/></svg>");
        fs::write(
            &input,
            b"<svg><image href='https://example.invalid/x'/></svg>",
        )
        .unwrap();
        let result = process_json(&serde_json::to_vec(&req).unwrap(), &input, &output);
        assert_eq!(result["reason"], "invalidContent");
        fs::write(
            &input,
            b"<svg viewBox='0 0 1e999 10'><path transform='scale(999999999)' d='M0 0'/></svg>",
        )
        .unwrap();
        let result = process_json(&serde_json::to_vec(&req).unwrap(), &input, &output);
        assert!(matches!(
            result["reason"].as_str(),
            Some("invalidContent" | "limitExceeded")
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn canonicalizes_png_to_rgba() {
        let root = root("png");
        let input = root.join("input");
        let output = root.join("output");
        let mut source = Vec::new();
        {
            let mut e = png::Encoder::new(&mut source, 2, 1);
            e.set_color(png::ColorType::Rgb);
            e.set_depth(png::BitDepth::Eight);
            let mut w = e.write_header().unwrap();
            w.write_image_data(&[255, 0, 0, 0, 255, 0]).unwrap();
        }
        fs::write(&input, source).unwrap();
        fs::write(&output, b"").unwrap();
        let req = request(
            "canonicalizeRaster",
            json!({ "inputBytes": 4096, "outputBytes": 4096, "decodedPixels": 10, "width": 10, "height": 10 }),
        );
        let result = process_json(&serde_json::to_vec(&req).unwrap(), &input, &output);
        assert_eq!(result["status"], "succeeded");
        assert_eq!(result["mediaType"], "image/png");
        assert_eq!(result["observed"]["decodedPixels"], 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inspects_typst_compatible_font_and_rejects_truncated_tables() {
        let root = root("font");
        let input = root.join("input");
        let output = root.join("output");
        let fixture = include_str!("../tests/fixtures/NotoSansTest-Regular.hex");
        let font = hex::decode(fixture.split_ascii_whitespace().collect::<String>()).unwrap();
        fs::write(&input, &font).unwrap();
        fs::write(&output, b"").unwrap();
        let req = request(
            "inspectFont",
            json!({ "inputBytes": 50_000, "outputBytes": 50_000 }),
        );
        let result = process_json(&serde_json::to_vec(&req).unwrap(), &input, &output);
        assert_eq!(result["status"], "succeeded", "{result}");
        assert_eq!(result["typstLoadable"], true);
        assert!(result["unicodeCoverageSummary"]
            .as_str()
            .unwrap()
            .contains("codepoints="));
        assert_eq!(fs::read(&output).unwrap(), font);

        fs::write(&input, &font[..font.len() / 2]).unwrap();
        let result = process_json(&serde_json::to_vec(&req).unwrap(), &input, &output);
        assert_eq!(result["status"], "failed");
        assert_eq!(result["reason"], "invalidContent");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extracts_regular_zip_closure_and_rejects_traversal() {
        let root = root("zip");
        let input = root.join("input");
        let output = root.join("output");
        fs::create_dir(&output).unwrap();
        fs::write(&input, stored_zip("assets/logo.svg", b"<svg/>")).unwrap();
        let req = request(
            "inspectArchive",
            json!({ "compressedBytes": 4096, "uncompressedBytes": 4096, "entries": 10, "entryBytes": 4096, "compressionRatio": 200 }),
        );
        let result = process_json(&serde_json::to_vec(&req).unwrap(), &input, &output);
        assert_eq!(result["status"], "succeeded");
        assert_eq!(result["entries"][0]["path"], "assets/logo.svg");
        assert_eq!(
            result["outputHash"],
            "sha256:0596a565ea5e67e22f20d4c8b5e0a551c21b57ab8b423fa6d85b4ead16771eba",
            "This vector is generated by quarantineArchiveClosureHash in protocol.ts",
        );
        assert_eq!(fs::read(output.join("assets/logo.svg")).unwrap(), b"<svg/>");

        let aliased_output = root.join("aliased-output");
        fs::create_dir(&aliased_output).unwrap();
        fs::write(
            &input,
            stored_zip_entries(&[("Assets/a.txt", b"a"), ("assets/b.txt", b"b")]),
        )
        .unwrap();
        let result = process_json(&serde_json::to_vec(&req).unwrap(), &input, &aliased_output);
        assert_eq!(result["reason"], "invalidContent");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn archive_parser_exercises_deflate_and_rejects_hostile_metadata() {
        let root = root("zip-hostile");
        let input = root.join("input");
        let req = request(
            "inspectArchive",
            json!({ "compressedBytes": 16_384, "uncompressedBytes": 16_384, "entries": 10, "entryBytes": 16_384, "compressionRatio": 200 }),
        );
        let run = |archive: &[u8], label: &str| {
            let output = root.join(label);
            fs::create_dir(&output).unwrap();
            fs::write(&input, archive).unwrap();
            process_json(&serde_json::to_vec(&req).unwrap(), &input, &output)
        };

        let deflated = deflated_zip("deflated.txt", b"bounded DEFLATE payload");
        assert_eq!(run(&deflated, "deflate")["status"], "succeeded");

        let mut trailing = stored_zip("trailing.txt", b"x");
        trailing.push(0xff);
        assert_eq!(run(&trailing, "trailing")["reason"], "invalidContent");

        let mut mismatch = stored_zip("mismatch.txt", b"x");
        mismatch[8..10].copy_from_slice(&8u16.to_le_bytes());
        assert_eq!(run(&mismatch, "mismatch")["reason"], "invalidContent");

        let mut encrypted = stored_zip("encrypted.txt", b"x");
        encrypted[6..8].copy_from_slice(&1u16.to_le_bytes());
        let central = encrypted
            .windows(4)
            .position(|bytes| bytes == b"PK\x01\x02")
            .unwrap();
        encrypted[central + 8..central + 10].copy_from_slice(&1u16.to_le_bytes());
        assert_eq!(run(&encrypted, "encrypted")["reason"], "invalidContent");

        let mut overlap = stored_zip_entries(&[("one.txt", b"one"), ("two.txt", b"two")]);
        let central_records: Vec<usize> = overlap
            .windows(4)
            .enumerate()
            .filter_map(|(index, bytes)| (bytes == b"PK\x01\x02").then_some(index))
            .collect();
        overlap[central_records[1] + 42..central_records[1] + 46]
            .copy_from_slice(&0u32.to_le_bytes());
        assert_eq!(run(&overlap, "overlap")["reason"], "invalidContent");

        let one_entry_req = request(
            "inspectArchive",
            json!({ "compressedBytes": 16_384, "uncompressedBytes": 16_384, "entries": 1, "entryBytes": 16_384, "compressionRatio": 200 }),
        );
        let exact_output = root.join("exact-directory-count");
        fs::create_dir(&exact_output).unwrap();
        fs::write(&input, stored_zip("one/", b"")).unwrap();
        let exact = process_json(
            &serde_json::to_vec(&one_entry_req).unwrap(),
            &input,
            &exact_output,
        );
        assert_eq!(exact["reason"], "invalidContent");
        let over_output = root.join("over-directory-count");
        fs::create_dir(&over_output).unwrap();
        fs::write(&input, stored_zip_entries(&[("one/", b""), ("two/", b"")])).unwrap();
        let over = process_json(
            &serde_json::to_vec(&one_entry_req).unwrap(),
            &input,
            &over_output,
        );
        assert_eq!(over["reason"], "limitExceeded");

        fs::remove_dir_all(root).unwrap();
    }

    fn stored_zip(name: &str, bytes: &[u8]) -> Vec<u8> {
        stored_zip_entries(&[(name, bytes)])
    }

    fn stored_zip_entries(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let prepared: Vec<(&str, &[u8], u16, Vec<u8>)> = entries
            .iter()
            .map(|(name, bytes)| (*name, *bytes, 0, bytes.to_vec()))
            .collect();
        test_zip(&prepared)
    }

    fn deflated_zip(name: &str, bytes: &[u8]) -> Vec<u8> {
        let mut encoder =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(bytes).unwrap();
        let compressed = encoder.finish().unwrap();
        test_zip(&[(name, bytes, 8, compressed)])
    }

    fn test_zip(entries: &[(&str, &[u8], u16, Vec<u8>)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut records = Vec::new();
        for (name, bytes, method, compressed) in entries {
            let mut crc = Crc32::new();
            crc.update(bytes);
            let crc = crc.finalize();
            let offset = out.len() as u32;
            out.extend_from_slice(b"PK\x03\x04");
            out.extend_from_slice(&20u16.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&method.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&crc.to_le_bytes());
            out.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
            out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            out.extend_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(compressed);
            records.push((*name, *bytes, *method, compressed.len(), crc, offset));
        }
        let central_offset = out.len() as u32;
        for (name, bytes, method, compressed_len, crc, offset) in records {
            out.extend_from_slice(b"PK\x01\x02");
            out.extend_from_slice(&20u16.to_le_bytes());
            out.extend_from_slice(&20u16.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&method.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&crc.to_le_bytes());
            out.extend_from_slice(&(compressed_len as u32).to_le_bytes());
            out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            out.extend_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&0u32.to_le_bytes());
            out.extend_from_slice(&offset.to_le_bytes());
            out.extend_from_slice(name.as_bytes());
        }
        let central_size = out.len() as u32 - central_offset;
        out.extend_from_slice(b"PK\x05\x06");
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&central_size.to_le_bytes());
        out.extend_from_slice(&central_offset.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out
    }

    #[test]
    fn sha256_matches_standard_vector() {
        assert_eq!(
            sha256(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn pdf_is_an_explicit_unavailable_failure() {
        let root = root("pdf");
        let input = root.join("input");
        let output = root.join("output");
        fs::write(&input, b"%PDF-1.7\n").unwrap();
        fs::write(&output, b"").unwrap();
        let req = request(
            "flattenPdf",
            json!({ "inputBytes": 1024, "outputBytes": 1024, "pages": 10 }),
        );
        let result = process_json(&serde_json::to_vec(&req).unwrap(), &input, &output);
        assert_eq!(result["status"], "failed");
        assert_eq!(result["reason"], "isolationUnavailable");
        assert!(fs::read(&output).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
