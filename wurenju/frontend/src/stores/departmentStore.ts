import { create } from "zustand";
import { toast } from "@/hooks/use-toast";
import { departmentsApi, type BackendDepartment } from "@/services/api";
import { normalizeSystemIcon } from "@/utils/systemIcons";

export type Department = {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
};

type DepartmentState = {
  departments: Department[];
  loading: boolean;
  initialized: boolean;
  fetchDepartments: () => Promise<void>;
  initialize: () => Promise<void>;
  createDepartment: (payload: {
    id: string;
    name: string;
    icon: string;
    sortOrder: number;
  }) => Promise<Department>;
  updateDepartment: (
    id: string,
    payload: Partial<{
      name: string;
      icon: string;
      sortOrder: number;
    }>,
  ) => Promise<Department>;
  deleteDepartment: (id: string) => Promise<void>;
};

function normalizeDepartment(department: BackendDepartment | null | undefined): Department | null {
  if (!department) {
    return null;
  }

  const id = typeof department.id === "string" ? department.id.trim() : "";
  if (!id) {
    return null;
  }

  return {
    id,
    name: department.name?.trim() || id,
    icon: normalizeSystemIcon(department.icon, "building"),
    sortOrder: department.sort_order ?? 0,
  };
}

function sortDepartments(departments: Department[]) {
  return [...departments].toSorted((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return left.name.localeCompare(right.name, "zh-CN");
  });
}

export const useDepartmentStore = create<DepartmentState>((set, get) => ({
  departments: [],
  loading: false,
  initialized: false,

  fetchDepartments: async () => {
    set({ loading: true });

    try {
      const payload = await departmentsApi.list();
      const departments = sortDepartments(
        payload
          .map((department) => normalizeDepartment(department))
          .filter((department): department is Department => department !== null),
      );
      console.log(`[Store] 部门初始化完成: ${departments.length} 个`);
      set({ departments, loading: false, initialized: true });
    } catch (error) {
      console.warn("[Store] 拉取部门列表失败:", error);
      toast({
        title: "部门加载失败",
        description: error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
        variant: "destructive",
      });
      set({ loading: false, initialized: true });
    }
  },

  initialize: async () => {
    if (get().loading || get().initialized) {
      return;
    }

    await get().fetchDepartments();
  },

  createDepartment: async (payload) => {
    const created = normalizeDepartment(
      await departmentsApi.create({
        id: payload.id,
        name: payload.name,
        icon: payload.icon,
        sortOrder: payload.sortOrder,
      }),
    );
    if (!created) {
      throw new Error("部门数据格式不正确");
    }

    set((state) => ({
      departments: sortDepartments([...state.departments, created]),
    }));
    return created;
  },

  updateDepartment: async (id, payload) => {
    const updated = normalizeDepartment(
      await departmentsApi.update(id, {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.icon !== undefined ? { icon: payload.icon } : {}),
        ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
      }),
    );
    if (!updated) {
      throw new Error("部门数据格式不正确");
    }

    set((state) => ({
      departments: sortDepartments(
        state.departments.map((department) => (department.id === id ? updated : department)),
      ),
    }));
    return updated;
  },

  deleteDepartment: async (id) => {
    await departmentsApi.remove(id);
    set((state) => ({
      departments: state.departments.filter((department) => department.id !== id),
    }));
  },
}));
