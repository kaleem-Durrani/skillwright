import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { notification } from "antd";
import { debounce } from "lodash";
import { z } from "zod";
import { departmentApi } from "@/api";

// Define the Department schema using Zod
const DepartmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
});

// Define the array of departments schema
const DepartmentsSchema = z.array(DepartmentSchema);

// Define the Department type based on the schema
export type Department = z.infer<typeof DepartmentSchema>;

// Define the SelectOption type for dropdown components
export type SelectOption = {
  label: string;
  value: string;
};

// Define the context type
interface DepartmentContextType {
  departments: Department[];
  departmentOptions: SelectOption[];
  loading: boolean;
  error: string | null;
  refreshDepartments: () => Promise<void>;
}

// Create the context with a default value
const DepartmentContext = createContext<DepartmentContextType | undefined>(
  undefined
);

// Props for the provider component
interface DepartmentProviderProps {
  children: ReactNode;
}

export const DepartmentProvider: React.FC<DepartmentProviderProps> = ({
  children,
}) => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<SelectOption[]>(
    []
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Function to fetch departments
  const fetchDepartments = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await departmentApi.getAllDepartments();

      if (response?.data?.success && response.data.data) {
        // Validate the response data using Zod
        const validatedData = DepartmentsSchema.parse(response.data.data);

        // Set the departments
        setDepartments(validatedData);

        // Create options for select components
        const options = validatedData.map((dept) => ({
          label: dept.name,
          value: dept.id,
        }));

        setDepartmentOptions(options);
      } else {
        throw new Error("Failed to fetch departments");
      }
    } catch (err) {
      console.error("Error fetching departments:", err);

      if (err instanceof z.ZodError) {
        // Handle Zod validation errors
        setError("Invalid department data received from server");
        notification.error({
          message: "Data Validation Error",
          description:
            "The department data received from the server is invalid.",
        });
      } else {
        // Handle other errors
        setError("Failed to fetch departments");
        notification.error({
          message: "Failed to Load Departments",
          description: "Please try again later.",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Create a memoized refresh function
  const refreshDepartmentsRef = React.useRef(
    debounce(async () => {
      await fetchDepartments();
    }, 500)
  );

  // Fetch departments on component mount
  useEffect(() => {
    fetchDepartments();
    // Cleanup function to cancel any pending debounced calls when unmounting
    return () => {
      refreshDepartmentsRef.current.cancel();
    };
  }, []);

  // Context value
  const value = {
    departments,
    departmentOptions,
    loading,
    error,
    refreshDepartments: async () => await refreshDepartmentsRef.current(),
  };

  return (
    <DepartmentContext.Provider value={value}>
      {children}
    </DepartmentContext.Provider>
  );
};

// Custom hook to use the department context
export const useDepartmentContext = () => {
  const context = useContext(DepartmentContext);

  if (context === undefined) {
    throw new Error(
      "useDepartmentContext must be used within a DepartmentProvider"
    );
  }

  return context;
};
