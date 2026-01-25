/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type SecretsConfig = {
    name: string;
    kmsKey?: pulumi.Output<aws.kms.Key | aws.kms.ReplicaKey>;
    secretString?: Record<string, any>;
    description?: string;
    recoveryWindowInDays?: number;
    forceOverwriteReplicaSecret?: boolean;
    multiRegion?: boolean;
    failoverReplica?: boolean;
    regionReplica?: string;
    kmsKeyReplica?: pulumi.Output<aws.kms.Key | aws.kms.ReplicaKey>;
    tags?: Record<string, string>;
};

