output "raw_bucket_id" {
  value = aws_s3_bucket.raw.id
}

output "curated_bucket_id" {
  value = aws_s3_bucket.curated.id
}
