# Secret Rotation Runbook

## Scope
- Proxy runtime secrets injected as ECS task definition `secrets`.
- Includes tokens such as `VIPER_DEBUG_EVENTS_TOKEN` and upstream API credentials.

## Rotation Procedure
1. Create new secret version in AWS Secrets Manager or SSM Parameter Store.
2. Verify `proxy_secret_arns` in Terraform points to correct ARN.
3. Run `terraform plan` and review task definition changes.
4. Deploy via production workflow and verify `/healthz/public`.
5. Invalidate old credentials and remove deprecated secret versions.

## Validation Checklist
- Proxy starts with valid config (`invalid config` not present in logs).
- No authentication failures in upstream calls.
- Debug endpoint remains disabled in production.

## Rollback
- Repoint `proxy_secret_arns` to prior known-good ARN/version.
- Redeploy and verify service health.
