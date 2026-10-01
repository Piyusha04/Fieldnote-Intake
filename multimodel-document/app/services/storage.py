import os
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlparse


def store_document(document_id: str, filename: str, content: bytes) -> str:
    bucket = os.getenv("S3_BUCKET")
    key = f"documents/{document_id}/{Path(filename).name}"
    if bucket:
        import boto3

        client = boto3.client(
            "s3",
            region_name=os.getenv("AWS_REGION", "us-east-1"),
            endpoint_url=os.getenv("AWS_ENDPOINT_URL") or None,
        )
        client.upload_fileobj(BytesIO(content), bucket, key, ExtraArgs={"ContentType": "application/pdf"})
        return f"s3://{bucket}/{key}"

    directory = Path(os.getenv("UPLOAD_DIR", "./uploads"))
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{document_id}.pdf"
    destination.write_bytes(content)
    return str(destination)


def delete_document_file(storage_key: str | None) -> None:
    if not storage_key:
        return
    if storage_key.startswith("s3://"):
        import boto3

        parsed = urlparse(storage_key)
        boto3.client(
            "s3",
            region_name=os.getenv("AWS_REGION", "us-east-1"),
            endpoint_url=os.getenv("AWS_ENDPOINT_URL") or None,
        ).delete_object(Bucket=parsed.netloc, Key=unquote(parsed.path.lstrip("/")))
        return

    destination = Path(storage_key).resolve()
    upload_directory = Path(os.getenv("UPLOAD_DIR", "./uploads")).resolve()
    if destination.parent != upload_directory:
        raise ValueError("Stored file is outside the configured upload directory")
    destination.unlink(missing_ok=True)
