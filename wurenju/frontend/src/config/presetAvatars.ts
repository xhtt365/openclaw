export interface PresetAvatar {
  id: string;
  src: string;
  label: string;
  gender: "male" | "female";
}

export const PRESET_AVATARS: PresetAvatar[] = [
  { id: "f01", src: "/avatars/preset/female_01.jpg", label: "职业女性", gender: "female" },
  { id: "f02", src: "/avatars/preset/female_02.jpg", label: "知性美女", gender: "female" },
  { id: "f03", src: "/avatars/preset/female_03.jpg", label: "设计师", gender: "female" },
  { id: "f04", src: "/avatars/preset/female_04.jpg", label: "干练主管", gender: "female" },
  { id: "f05", src: "/avatars/preset/female_05.jpg", label: "高管女性", gender: "female" },
  { id: "f06", src: "/avatars/preset/female_06.jpg", label: "创意总监", gender: "female" },
  { id: "f07", src: "/avatars/preset/female_07.jpg", label: "营销经理", gender: "female" },
  { id: "f08", src: "/avatars/preset/female_08.jpg", label: "数据分析师", gender: "female" },
  { id: "f09", src: "/avatars/preset/female_09.jpg", label: "项目经理", gender: "female" },
  { id: "f10", src: "/avatars/preset/female_10.jpg", label: "HR总监", gender: "female" },
  { id: "m01", src: "/avatars/preset/male_01.jpg", label: "西装精英", gender: "male" },
  { id: "m02", src: "/avatars/preset/male_02.jpg", label: "潮流帅哥", gender: "male" },
  { id: "m03", src: "/avatars/preset/male_03.jpg", label: "技术骨干", gender: "male" },
  { id: "m04", src: "/avatars/preset/male_04.jpg", label: "运动型", gender: "male" },
  { id: "m05", src: "/avatars/preset/male_05.jpg", label: "CEO", gender: "male" },
  { id: "m06", src: "/avatars/preset/male_06.jpg", label: "设计师男", gender: "male" },
  { id: "m07", src: "/avatars/preset/male_07.jpg", label: "技术总监", gender: "male" },
  { id: "m08", src: "/avatars/preset/male_08.jpg", label: "产品经理", gender: "male" },
  { id: "m09", src: "/avatars/preset/male_09.jpg", label: "程序员", gender: "male" },
  { id: "m10", src: "/avatars/preset/male_10.jpg", label: "创业者", gender: "male" },
];
