import { studio, type StudioPhotoStore } from "@selio/core";
import { StorageObjectStore, type StorageClient, type StorageObjectStoreOptions } from "@selio/storage";

/**
 * Photos de Studio par leur clé de stockage (`org/<org>/studio-photo/<id>.<ext>`) : lecture pour la préparation et
 * la génération d'annonce, suppression de la photo d'une demande de photo portée annulée, refusée, en échec ou
 * purgée. L'API signe une URL courte (comme pour le navigateur) et lit ou efface l'objet elle-même : aucune URL
 * n'est rendue au client, le secret ne quitte pas l'API. Mise en œuvre partagée avec le worker dans
 * `@selio/storage` (`StorageObjectStore` : délai borné, aucune redirection, lecture plafonnée à 1,5 Mo + 1 octet).
 *
 * Le cœur vérifie la clé (préfixe de l'organisation de la session) AVANT d'appeler `read` ou `delete`.
 */
export type StoragePhotoStoreOptions = StorageObjectStoreOptions;

export class StoragePhotoStore extends StorageObjectStore implements StudioPhotoStore {
  constructor(storage: Pick<StorageClient, "presignDownload"> & Partial<Pick<StorageClient, "deleteObject">>, opts: StoragePhotoStoreOptions = {}) {
    super(storage, { maxBytes: studio.STUDIO_RECEIVED_MAX_BYTES, ...opts });
  }
}
