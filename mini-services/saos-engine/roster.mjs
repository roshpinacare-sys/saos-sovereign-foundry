/**
 * roster.mjs — R233 · מקור-האמת של סדר-הכוח (fleet roster).
 * הופרד מ-coordination.mjs כדי לשבור יבוא-מעגלי (coordination ↔ threads)
 * — מודול זה נקי-תלות לחלוטין וניתן-ליבוא מכל מקום.
 */
export const FLEET_ROSTER = [
  { name: "headcorner", kind: "master", lane: "zai" },
  ...["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"]
    .map((name) => ({ name, kind: "army", lane: "second-signer" })),
  ...["hcsoldier1", "hcsoldier2", "hcsoldier3"].map((name) => ({ name, kind: "soldier", lane: "zai" })),
];
export const FLEET_NAMES = FLEET_ROSTER.map((a) => a.name);
