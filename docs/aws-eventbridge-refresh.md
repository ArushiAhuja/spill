# AWS EventBridge monitoring refresh

This stack schedules the existing, authenticated production refresh endpoint every 15 minutes:

`EventBridge Scheduler → Lambda → https://beforeitspills.com/api/cron/refresh`

The Lambda is intentional: EventBridge API Destinations enforce a five-second outbound HTTP client timeout, while a full all-organisation refresh can run longer. The scheduler invokes Lambda, and Lambda allows up to five minutes for the existing Spill endpoint.

## Deploy

Authenticate the AWS CLI to the intended account, then run the following from the repository root. Use the existing production `CRON_SECRET` value from Vercel; do not put it in a shell history, source file, or commit.

```bash
aws cloudformation deploy \
  --region <aws-region> \
  --stack-name spill-production-refresh \
  --template-file infrastructure/aws/eventbridge-refresh.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides SpillCronSecret='<existing Vercel CRON_SECRET>'
```

Verify the scheduler and inspect the most recent execution logs:

```bash
aws scheduler get-schedule \
  --region <aws-region> \
  --group-name spill-monitoring \
  --name spill-production-refresh-every-15-minutes

aws logs tail /aws/lambda/spill-production-refresh \
  --region <aws-region> --since 30m
```

The existing daily Vercel cron remains a fallback. The EventBridge schedule should be disabled or deleted before removing the refresh endpoint.
