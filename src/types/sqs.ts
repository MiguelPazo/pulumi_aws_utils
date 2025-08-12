/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";

export type SqsConfig = {
    name: string;
    visibilityTimeoutSeconds?: number;
    messageRetentionPeriod?: number;
    receiveWaitTimeSeconds?: number;
    delaySeconds?: number;
    maxReceiveCount?: number;
    kmsDataKeyReusePeriodSeconds?: number;
    fifoQueue?: boolean;
    contentBasedDeduplication?: boolean;
    deduplicationScope?: "messageGroup" | "queue";
    fifoThroughputLimit?: "perQueue" | "perMessageGroupId";
    dlqVisibilityTimeoutSeconds?: number;
    dlqMessageRetentionPeriod?: number;
    dlqReceiveWaitTimeSeconds?: number;
    dlqDelaySeconds?: number;
    allowedPrincipals?: string[];
    allowedSourceArns?: string[];
};

export type SqsResult = {
    queue: aws.sqs.Queue;
    dlq: aws.sqs.Queue;
    kms: aws.kms.Key;
    queuePolicy?: aws.sqs.QueuePolicy;
};