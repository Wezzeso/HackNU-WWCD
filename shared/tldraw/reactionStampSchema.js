import { createShapePropsMigrationSequence, createTLSchema, defaultShapeSchemas, } from '@tldraw/tlschema';
import { T } from '@tldraw/validate';
export const REACTION_STAMP_SHAPE_TYPE = 'reaction-stamp';
export const REACTION_STAMP_IDS = ['like', 'love', 'hate'];
export const reactionStampShapeProps = {
    w: T.number,
    h: T.number,
    reaction: T.literalEnum(...REACTION_STAMP_IDS),
    ownerId: T.string,
    ownerName: T.string,
    ownerColor: T.string,
};
export const reactionStampShapeMigrations = createShapePropsMigrationSequence({ sequence: [] });
export const reactionStampTLSchema = createTLSchema({
    shapes: {
        ...defaultShapeSchemas,
        [REACTION_STAMP_SHAPE_TYPE]: {
            props: reactionStampShapeProps,
            migrations: reactionStampShapeMigrations,
        },
    },
});
//# sourceMappingURL=reactionStampSchema.js.map