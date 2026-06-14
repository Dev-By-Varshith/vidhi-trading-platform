resource "aws_db_subnet_group" "main" {
  name       = "vidhi-db-subnet"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

resource "aws_db_instance" "main" {
  identifier           = "vidhi-db"
  engine               = "postgres"
  engine_version       = "16"
  instance_class       = "db.t3.micro"
  allocated_storage    = 20
  username             = "vidhi_admin"
  password             = "vidhi_secret_123!" # Change this in production or use secrets manager
  db_subnet_group_name = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  skip_final_snapshot  = true
  publicly_accessible  = false
}

output "db_endpoint" {
  value = aws_db_instance.main.endpoint
}
