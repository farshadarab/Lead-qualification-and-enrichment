import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { LeadRecord, ScoringConfig } from '../shared/types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  await ensureUserWorkspaceProfile(cred.user);
  return cred.user;
}

export async function signOutSdr(): Promise<void> {
  await signOut(auth);
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export async function ensureUserWorkspaceProfile(user: User): Promise<void> {
  const uid = sanitizeId(user.uid);
  const userPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/info`;

  try {
    const existing = await getDocFromServer(doc(db, 'users', uid)).catch(() => null);
    if (!existing || !existing.exists()) {
      await setDoc(doc(db, 'users', uid), {
        uid,
        displayName: (user.displayName || user.email?.split('@')[0] || 'SDR Operator').slice(0, 120),
        role: 'SDR',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(
        doc(db, 'users', uid),
        {
          displayName: (user.displayName || user.email?.split('@')[0] || 'SDR Operator').slice(0, 120),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (user.email) {
      await setDoc(
        doc(db, 'users', uid, 'private', 'info'),
        {
          uid,
          email: user.email.slice(0, 254),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('permission')) {
      handleFirestoreError(err, OperationType.WRITE, userPath || privatePath);
    }
  }
}

export interface SyncedLeadSnapshot {
  leadId: string;
  stage: LeadRecord['stage'];
  totalScore: number;
  overrideReason?: string;
  hubspotSynced: boolean;
}

export function subscribeUserLeadQueue(
  uid: string,
  onChange: (items: SyncedLeadSnapshot[]) => void,
): Unsubscribe {
  const safeUid = sanitizeId(uid);
  const path = `users/${safeUid}/leads`;
  return onSnapshot(
    collection(db, 'users', safeUid, 'leads'),
    (snapshot) => {
      const items: SyncedLeadSnapshot[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          leadId: String(data.leadId || d.id),
          stage: data.stage as LeadRecord['stage'],
          totalScore: Number(data.totalScore || 0),
          overrideReason: typeof data.overrideReason === 'string' ? data.overrideReason : undefined,
          hubspotSynced: Boolean(data.hubspotSynced),
        };
      });
      onChange(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export async function syncLeadToFirestore(uid: string, lead: LeadRecord): Promise<void> {
  const safeUid = sanitizeId(uid);
  const safeLeadId = sanitizeId(lead.id);
  const path = `users/${safeUid}/leads/${safeLeadId}`;
  try {
    const ref = doc(db, 'users', safeUid, 'leads', safeLeadId);
    const existing = await getDocFromServer(ref).catch(() => null);
    const basePayload = {
      leadId: safeLeadId,
      ownerUid: safeUid,
      companyName: lead.company.name.slice(0, 160),
      companyDomain: lead.company.domain.slice(0, 160),
      contactName: lead.contactName.slice(0, 160),
      jobTitle: lead.jobTitle.slice(0, 160),
      stage: lead.stage,
      totalScore: Math.max(0, Math.min(100, Math.round(lead.qualification.totalScore))),
      ...(lead.qualification.overrideReason
        ? { overrideReason: lead.qualification.overrideReason.slice(0, 500) }
        : {}),
      hubspotSynced: Boolean(lead.hubspot.synced),
      updatedAt: serverTimestamp(),
    };

    if (!existing || !existing.exists()) {
      await setDoc(ref, {
        ...basePayload,
        createdAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, basePayload, { merge: true });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncConfigToFirestore(uid: string, config: ScoringConfig): Promise<void> {
  const safeUid = sanitizeId(uid);
  const safeCfgId = sanitizeId(config.id || 'default-icp-v1');
  const path = `users/${safeUid}/configs/${safeCfgId}`;
  try {
    const ref = doc(db, 'users', safeUid, 'configs', safeCfgId);
    const existing = await getDocFromServer(ref).catch(() => null);
    const payload = {
      ownerUid: safeUid,
      industryWeight: config.weights.industryFit,
      sizeWeight: config.weights.companySize,
      geographyWeight: config.weights.geography,
      seniorityWeight: config.weights.jobSeniority,
      useCaseWeight: config.weights.useCaseFit,
      intentWeight: config.weights.buyingIntent,
      updatedAt: serverTimestamp(),
    };
    if (!existing || !existing.exists()) {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
    } else {
      await setDoc(ref, payload, { merge: true });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}
