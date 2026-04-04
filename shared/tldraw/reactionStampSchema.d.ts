import { type TLBaseShape, type RecordProps } from '@tldraw/tlschema';
export declare const REACTION_STAMP_SHAPE_TYPE = "reaction-stamp";
export declare const REACTION_STAMP_IDS: readonly ["like", "love", "hate"];
export type StampReaction = (typeof REACTION_STAMP_IDS)[number];
export interface ReactionStampProps {
    w: number;
    h: number;
    reaction: StampReaction;
    ownerId: string;
    ownerName: string;
    ownerColor: string;
}
type ReactionStampBaseShape = TLBaseShape<typeof REACTION_STAMP_SHAPE_TYPE, ReactionStampProps>;
export declare const reactionStampShapeProps: RecordProps<ReactionStampBaseShape>;
export declare const reactionStampShapeMigrations: import("tldraw").TLPropsMigrations;
export declare const reactionStampTLSchema: import("tldraw").TLSchema;
export {};
