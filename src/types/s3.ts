/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type S3Config = {
    name: string;
    kmsKey?: pulumi.Output<aws.kms.Key>;
    s3Logs?: pulumi.Output<aws.s3.Bucket>;
    enableCors?: boolean;
    enableReceiveLogs?: boolean;
    enableCloudfrontLogs?: boolean;
    cloudfront?: pulumi.Output<aws.cloudfront.Distribution>;
    fullName?: pulumi.Output<string> | string;
    enableObjectLock?: boolean;
    disableAcl?: boolean;
    disablePolicy?: boolean;
    provider?: aws.Provider;
};
