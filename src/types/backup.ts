/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type BackupPlan = {
    name: string;
    schedule: string;
    startWindowMinutes: number;
    completionWindowMinutes: number;
    deleteAfterDays: number;
};

export type BackupCopy = {
    provider: aws.Provider;
    kmsKey: pulumi.Output<aws.kms.ReplicaKey>;
};

export type BackupConfig = {
    name: string;
    kmsKey?: pulumi.Output<aws.kms.Key>;
    copies?: BackupCopy[];
    plans?: BackupPlan[];
};

export type BackupResult = {
    role: aws.iam.Role;
    vault: aws.backup.Vault;
    vaultsCopy?: aws.backup.Vault[];
    planDynamoDb: aws.backup.Plan;
    planRds: aws.backup.Plan;
    selectionDynamoDb: aws.backup.Selection;
    selectionRds: aws.backup.Selection;
};
