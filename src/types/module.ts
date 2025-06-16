/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";

export type InitConfig = {
    project: string;
    stack: string;
    accountId: Promise<string>;
    generalPrefix: string;
    generalPrefixShort: string;
    generalTags: {};
    region: aws.Region;
    albSslPolicyDefault: string;
    cloudwatchRetentionLogs: number;
    apigwLogLevel: string;
    cfCachePolicyBackendMin: number;
    cfCachePolicyBackendDefault: number;
    cfCachePolicyBackendMax: number;
    cfOriginPolicyCorsS3: string
}
