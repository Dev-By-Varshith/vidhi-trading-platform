resource "aws_sqs_queue" "submissions" {
  name                      = "vidhi-submissions"
  delay_seconds             = 0
  max_message_size          = 262144
  message_retention_seconds = 86400
  receive_wait_time_seconds = 10
}

output "sqs_queue_url" {
  value = aws_sqs_queue.submissions.url
}
