# To fulfill the reference to aws_key_pair.deploy.key_name, we add this locally.
resource "tls_private_key" "deploy_key" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "deploy" {
  key_name   = "vidhi-deploy-key"
  public_key = tls_private_key.deploy_key.public_key_openssh
}

resource "aws_instance" "sim_runner" {
  ami                    = "ami-0c02fb55956c7d316"  # Amazon Linux 2 in us-east-1
  instance_type          = "c6i.2xlarge"             # 8 vCPU, 16GB RAM
  subnet_id              = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.sim_runner.id]
  key_name               = aws_key_pair.deploy.key_name

  # 50GB SSD for code compilation + containers
  root_block_device {
    volume_size = 50
    volume_type = "gp3"
  }

  # Bootstrap script: install Docker, isolate CPUs, enable hugepages
  user_data = file("${path.module}/scripts/ec2_bootstrap.sh")

  tags = { Name = "vidhi-sim-runner" }
}
