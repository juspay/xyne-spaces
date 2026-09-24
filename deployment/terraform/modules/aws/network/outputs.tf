output "vpc_id" {
  value = aws_vpc.this.id
}

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}

output "availability_zones" {
  value = local.azs
}

output "public_subnet_ids" {
  value = [for az in local.azs : aws_subnet.public[az].id]
}

output "private_subnet_ids" {
  value = [for az in local.azs : aws_subnet.private[az].id]
}

output "nat_gateway_ids" {
  value = [for az in local.nat_azs : aws_nat_gateway.this[az].id]
}

output "db_subnet_group_name" {
  value = aws_db_subnet_group.this.name
}

output "elasticache_subnet_group_name" {
  value = aws_elasticache_subnet_group.this.name
}

output "cluster_security_group_id" {
  value = aws_security_group.cluster.id
}

output "node_security_group_id" {
  value = aws_security_group.nodes.id
}

output "postgres_security_group_id" {
  value = aws_security_group.postgres.id
}

output "redis_security_group_id" {
  value = aws_security_group.redis.id
}

output "livekit_security_group_id" {
  value = aws_security_group.livekit.id
}

output "bastion_security_group_id" {
  value = aws_security_group.bastion.id
}
