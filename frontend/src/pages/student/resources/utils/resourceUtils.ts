import { ResourceWithDetails, ResourceType } from '@/common/types';

/**
 * Filter resources by type
 * @param resources List of resources
 * @param type Resource type to filter by
 * @returns Filtered resources
 */
export const filterResourcesByType = (
  resources: ResourceWithDetails[],
  type: ResourceType | ''
): ResourceWithDetails[] => {
  if (!type) return resources;
  return resources.filter((resource) => resource.type === type);
};

/**
 * Filter resources by course
 * @param resources List of resources
 * @param courseId Course ID to filter by
 * @returns Filtered resources
 */
export const filterResourcesByCourse = (
  resources: ResourceWithDetails[],
  courseId: string
): ResourceWithDetails[] => {
  if (!courseId) return resources;
  return resources.filter((resource) => resource.courseId === courseId);
};

/**
 * Search resources by title or description
 * @param resources List of resources
 * @param searchText Text to search for
 * @returns Filtered resources
 */
export const searchResources = (
  resources: ResourceWithDetails[],
  searchText: string
): ResourceWithDetails[] => {
  if (!searchText) return resources;
  const lowerCaseSearch = searchText.toLowerCase();
  return resources.filter(
    (resource) =>
      resource.title.toLowerCase().includes(lowerCaseSearch) ||
      (resource.description && resource.description.toLowerCase().includes(lowerCaseSearch))
  );
};
