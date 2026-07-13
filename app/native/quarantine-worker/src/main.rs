use std::io::{self, Read};
use std::path::Path;

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--probe") {
        return;
    }

    let mut input = Vec::new();
    let result = if io::stdin().take(1_048_577).read_to_end(&mut input).is_err()
        || input.len() > 1_048_576
    {
        cbb_quarantine_worker::uncorrelated_failure(
            "invalidContent",
            "The quarantine request was not valid bounded JSON.",
        )
    } else {
        cbb_quarantine_worker::process_json(
            &input,
            Path::new("/work/input"),
            Path::new("/work/output"),
        )
    };

    // serde_json cannot fail while serializing the worker-owned value tree.
    println!("{}", serde_json::to_string(&result).unwrap_or_else(|_| {
        "{\"version\":1,\"requestId\":\"00000000-0000-4000-8000-000000000000\",\"operation\":\"sanitizeSvg\",\"status\":\"failed\",\"code\":\"CBB-SECURITY-0001\",\"reason\":\"workerCrash\",\"message\":\"The quarantine worker could not serialize its result.\"}".to_owned()
    }));
}
