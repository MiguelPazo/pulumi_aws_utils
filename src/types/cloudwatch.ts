/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type DataIdentifierConfig = {
    categories?: string[];
    customIdentifiers?: string[];
};

export type AuditDestination = {
    cloudWatchLogs?: {
        logGroup: pulumi.Input<string>;
    };
    firehose?: {
        deliveryStream: pulumi.Input<string>;
    };
    s3?: {
        bucket: pulumi.Input<string>;
    };
};

export type CloudWatchDataProtectionConfig = {
    name: string;
    auditMode?: boolean;
    deidentifyMode?: boolean;
    dataIdentifiers?: DataIdentifierConfig;
    auditDestination?: AuditDestination;
    kmsKey?: pulumi.Input<aws.kms.Key>;
};

export type CloudWatchDataProtectionResult = {
    policyDocument: pulumi.Output<string>;
    auditLogGroup?: aws.cloudwatch.LogGroup;
};
