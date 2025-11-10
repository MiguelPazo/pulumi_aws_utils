/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type VpcImportResult = {
    vpc: aws.ec2.Vpc;
    id: pulumi.Output<string>;
    publicSubnets: pulumi.Output<aws.ec2.Subnet[]>;
    privateSubnets: pulumi.Output<aws.ec2.Subnet[]>;
    isolatedSubnets: pulumi.Output<aws.ec2.Subnet[]>;
    databasesSubnets: pulumi.Output<aws.ec2.Subnet[]>;
    elasticacheSubnets: pulumi.Output<aws.ec2.Subnet[]>;
    publicSubnetIds: pulumi.Output<string[]>;
    privateSubnetIds: pulumi.Output<string[]>;
    isolatedSubnetIds: pulumi.Output<string[]>;
    databasesSubnetIds: pulumi.Output<string[]>;
    elasticacheSubnetIds: pulumi.Output<string[]>;
}