/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export type RdsConfig = {
    allocatedStorage: number;
    engine: string;
    engineVersion: string;
    instanceClass: string;
    dbName: string;
    port: number;
    username: string;
    password: string;
    skipFinalSnapshot: boolean;
    publiclyAccessible: boolean;
    domainRdsReader: string;
    domainRdsWriter: string;
};

export type RdsResult = {
    instance: aws.rds.Instance;
    kms: aws.kms.Key;
    securityGroup: pulumi.Output<awsx.classic.ec2.SecurityGroup>;
};
