#!/bin/bash
# Install Docker
yum update -y && yum install -y docker git
systemctl start docker && systemctl enable docker
usermod -aG docker ec2-user

# Install Go for job worker
wget https://go.dev/dl/go1.22.linux-amd64.tar.gz
tar -C /usr/local -xzf go1.22.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile

# Enable hugepages (needed for C++ Game Master)
echo "vm.nr_hugepages = 128" >> /etc/sysctl.conf
sysctl -p

# Reserve CPUs 2-3 for Game Master (isolcpus in GRUB is better, this is the fast path)
echo 2-3 > /sys/devices/system/cpu/isolated 2>/dev/null || true
