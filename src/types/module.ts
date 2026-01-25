/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";

export type InitConfig = {
    project: string;
    stack: string;
    stackAlias: string;
    accountId: Promise<string>;
    generalPrefix: string;
    generalPrefixShort: string;
    generalPrefixShort2: string;
    generalTags: {};
    region: string;
    providerVirginia: aws.Provider;
    albSslPolicyDefault?: string;
    cloudwatchRetentionLogs: number;
    deleteProtection: boolean;
    failoverReplica?: boolean;
}
