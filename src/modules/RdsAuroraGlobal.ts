/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {RdsAuroraGlobalModuleConfig} from "../types";

class RdsAuroraGlobal {
    private static __instance: RdsAuroraGlobal;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): RdsAuroraGlobal {
        if (this.__instance == null) {
            this.__instance = new RdsAuroraGlobal();
        }

        return this.__instance;
    }

    async main(config: RdsAuroraGlobalModuleConfig): Promise<aws.rds.GlobalCluster> {
        const {
            globalClusterIdentifier,
            engine,
            engineVersion,
            databaseName,
            deletionProtection,
        } = config;

        return new aws.rds.GlobalCluster(
            `${this.config.project}-${globalClusterIdentifier}-global`,
            {
                globalClusterIdentifier: `${this.config.generalPrefix}-${globalClusterIdentifier}`,
                engine: engine,
                engineVersion: engineVersion,
                databaseName: databaseName,
                deletionProtection: deletionProtection ?? this.config.deleteProtection,
                storageEncrypted: true,
            }
        );
    }
}

export {RdsAuroraGlobal}
