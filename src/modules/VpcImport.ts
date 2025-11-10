/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {VpcImportResult} from "../types";

class VpcImport {
    private static __instance: VpcImport;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): VpcImport {
        if (this.__instance == null) {
            this.__instance = new VpcImport();
        }

        return this.__instance;
    }

    async main(
        vpcId: pulumi.Output<string>,
        patterns = {
            public: "*-public*",
            private: "*-private*",
            isolated: "*-isolated*",
            databases: "*-databases*",
            elasticache: "*-elasticache*",
        }
    ): Promise<VpcImportResult> {
        const vpc = aws.ec2.Vpc.get(`${this.config.project}-vpc`, vpcId);

        const getSubnets = (tagPattern: string) => {
            const subnetsOutput: pulumi.Output<aws.ec2.Subnet[]> = vpcId.apply(async id => {
                const result = await aws.ec2.getSubnets({
                    filters: [
                        {name: "vpc-id", values: [id]},
                        {name: "tag:Name", values: [tagPattern]},
                    ],
                });

                return result.ids.map((subnetId, index) =>
                    aws.ec2.Subnet.get(`${this.config.project}-${tagPattern}-${index}`, subnetId)
                );
            });

            const subnetIdsOutput: pulumi.Output<string[]> = vpcId.apply(async id => {
                const result = await aws.ec2.getSubnets({
                    filters: [
                        {name: "vpc-id", values: [id]},
                        {name: "tag:Name", values: [tagPattern]},
                    ],
                });
                return result.ids;
            });

            return {subnets: subnetsOutput, subnetIds: subnetIdsOutput};
        };

        const publicResult = getSubnets(patterns.public);
        const privateResult = getSubnets(patterns.private);
        const isolatedResult = getSubnets(patterns.isolated);
        const databasesResult = getSubnets(patterns.databases);
        const elasticacheResult = getSubnets(patterns.elasticache);

        return {
            vpc,
            id: vpc.id,
            publicSubnets: publicResult.subnets,
            privateSubnets: privateResult.subnets,
            isolatedSubnets: isolatedResult.subnets,
            databasesSubnets: databasesResult.subnets,
            elasticacheSubnets: elasticacheResult.subnets,
            publicSubnetIds: publicResult.subnetIds,
            privateSubnetIds: privateResult.subnetIds,
            isolatedSubnetIds: isolatedResult.subnetIds,
            databasesSubnetIds: databasesResult.subnetIds,
            elasticacheSubnetIds: elasticacheResult.subnetIds,
        } as VpcImportResult;
    }
}

export {VpcImport};
