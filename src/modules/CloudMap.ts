/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {CloudMapConfig, CloudMapResult, VpcImportResult} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class CloudMap {
    private static __instance: CloudMap;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): CloudMap {
        if (this.__instance == null) {
            this.__instance = new CloudMap();
        }

        return this.__instance;
    }

    /**
     * Creates a Private DNS Namespace (for VPC-only discovery and Service Connect)
     */
    async main(
        namespaceConfig: CloudMapConfig,
        vpc: pulumi.Output<VpcImportResult>
    ): Promise<CloudMapResult> {
        const namespace = new aws.servicediscovery.PrivateDnsNamespace(
            `${this.config.project}-${namespaceConfig.nameShort}-ns`,
            {
                name: namespaceConfig.name,
                description: namespaceConfig.description || `Private namespace for ${namespaceConfig.name}`,
                vpc: vpc.id,
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-${namespaceConfig.nameShort}-ns`,
                }
            }
        );

        return {
            namespace: namespace,
            namespaceId: namespace.id,
            namespaceArn: namespace.arn,
            namespaceName: namespace.name
        };
    }
}

export {CloudMap}
