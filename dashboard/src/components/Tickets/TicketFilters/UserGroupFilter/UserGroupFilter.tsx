// import { ReactElement, useState, useEffect, useRef } from 'react';
// import { Search, X, Users, ChevronDown } from 'lucide-react';
// import { useQuery } from '@rocicorp/zero/react';
// import { Button } from '../../../ui/Button';
// // import { searchUserGroups, getUserGroupsByIds } from '../../../../zero/queries';
// import { useAuthContextValues } from '../../../../hooks/useAuth';
// import { UserGroupFilterProps } from '../types';

// export const UserGroupFilter = ({
//   selectedGroups,
//   onChange,
//   placeholder = 'Search user groups...',
//   className = '',
// }: UserGroupFilterProps): ReactElement => {
//   const [isOpen, setIsOpen] = useState(false);
//   const [searchQuery, setSearchQuery] = useState('');
//   const [searchTerm, setSearchTerm] = useState('');
//   const dropdownRef = useRef<HTMLDivElement>(null);
//   const searchInputRef = useRef<HTMLInputElement>(null);

//   const context = useAuthContextValues();

//   // Debounced search query
//   useEffect(() => {
//     const timer = setTimeout(() => {
//       setSearchTerm(searchQuery);
//     }, 300);

//     return (): void => clearTimeout(timer);
//   }, [searchQuery]);

//   // Search user groups with debounced query
//   const [searchResults] = useQuery(
//     searchTerm ? searchUserGroups(context, searchTerm, 20) : searchUserGroups(context, '', 20),
//   );

//   // Get selected groups data by their IDs (persists even when searching)
//   const [selectedGroupsData] = useQuery(getUserGroupsByIds(context, selectedGroups));

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event: MouseEvent): void => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
//         setIsOpen(false);
//       }
//     };

//     if (isOpen) {
//       document.addEventListener('mousedown', handleClickOutside);
//     }

//     return (): void => {
//       document.removeEventListener('mousedown', handleClickOutside);
//     };
//   }, [isOpen]);

//   // Focus search input when dropdown opens
//   useEffect(() => {
//     if (isOpen && searchInputRef.current) {
//       searchInputRef.current.focus();
//     }
//   }, [isOpen]);

//   const handleGroupToggle = (groupId: string): void => {
//     const isSelected = selectedGroups.includes(groupId);

//     if (isSelected) {
//       onChange(selectedGroups.filter(id => id !== groupId));
//     } else {
//       onChange([...selectedGroups, groupId]);
//     }
//   };

//   const handleClear = (): void => {
//     onChange([]);
//     setSearchQuery('');
//   };

//   const handleRemoveGroup = (groupId: string): void => {
//     onChange(selectedGroups.filter(id => id !== groupId));
//   };

//   const hasSelection = selectedGroups.length > 0;
//   const availableGroups = (searchResults || []).filter(group => !selectedGroups.includes(group.id));

//   return (
//     <div className={`relative ${className}`} ref={dropdownRef}>
//       {/* Trigger Button */}
//       <button
//         onClick={() => setIsOpen(!isOpen)}
//         className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors min-w-0 ${
//           hasSelection
//             ? 'border-blue-200 bg-blue-50 text-blue-700'
//             : 'border-border bg-background text-foreground hover:bg-muted'
//         }`}
//       >
//         <Users className='w-4 h-4 flex-shrink-0' />
//         <span className='truncate'>
//           {hasSelection
//             ? `${selectedGroups.length} group${selectedGroups.length > 1 ? 's' : ''}`
//             : placeholder}
//         </span>
//         {hasSelection && (
//           <span className='bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full flex-shrink-0'>
//             {selectedGroups.length}
//           </span>
//         )}
//         <ChevronDown className='w-4 h-4 flex-shrink-0' />
//       </button>

//       {/* Clear Button */}
//       {hasSelection && !isOpen && (
//         <Button
//           onClick={handleClear}
//           variant='ghost'
//           size='icon'
//           className='absolute -top-1 -right-1 bg-muted hover:bg-border rounded-full p-1 size-6'
//           title='Clear group filter'
//         >
//           <X className='w-3 h-3 text-muted-foreground' />
//         </Button>
//       )}

//       {/* Dropdown */}
//       {isOpen && (
//         <div className='absolute top-full left-0 mt-1 w-80 bg-background border border-border rounded-lg shadow-lg z-50'>
//           {/* Search Input */}
//           <div className='p-3 border-b border-gray-100'>
//             <div className='relative'>
//               <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground' />
//               <input
//                 ref={searchInputRef}
//                 type='text'
//                 value={searchQuery}
//                 onChange={e => setSearchQuery(e.target.value)}
//                 placeholder={placeholder}
//                 className='w-full pl-10 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
//               />
//             </div>
//           </div>

//           {/* Selected Groups */}
//           {selectedGroupsData.length > 0 && (
//             <div className='p-3 border-b border-gray-100'>
//               <div className='text-xs font-medium text-muted-foreground mb-2'>Selected Groups</div>
//               <div className='space-y-1'>
//                 {selectedGroupsData.map(group => (
//                   <div
//                     key={group.id}
//                     className='flex items-center justify-between p-2 bg-blue-50 border border-blue-200 rounded'
//                   >
//                     <div className='flex items-center gap-2 min-w-0 flex-1'>
//                       <Users className='w-4 h-4 text-blue-600 flex-shrink-0' />
//                       <div className='min-w-0 flex-1'>
//                         <div className='text-sm font-medium text-blue-900 truncate'>
//                           {group.name}
//                         </div>
//                         {group.alias && (
//                           <div className='text-xs text-blue-700 truncate'>@{group.alias}</div>
//                         )}
//                       </div>
//                     </div>
//                     <Button
//                       onClick={() => handleRemoveGroup(group.id)}
//                       variant='ghost'
//                       size='iconSm'
//                       className='p-1 hover:bg-blue-100 rounded transition-colors'
//                       title={`Remove ${group.name}`}
//                     >
//                       <X className='w-3 h-3 text-blue-600' />
//                     </Button>
//                   </div>
//                 ))}
//               </div>
//             </div>
//           )}

//           {/* Available Groups */}
//           <div className='max-h-64 overflow-y-auto'>
//             {availableGroups.length > 0 ? (
//               <div className='p-2'>
//                 <div className='text-xs font-medium text-muted-foreground mb-2'>Available Groups</div>
//                 <div className='space-y-1'>
//                   {availableGroups.map(group => (
//                     <button
//                       key={group.id}
//                       onClick={() => handleGroupToggle(group.id)}
//                       className='flex items-center gap-3 p-2 hover:bg-muted rounded cursor-pointer transition-colors w-full text-left'
//                       type='button'
//                     >
//                       <div className='w-4 h-4 border-2 border-input rounded' />
//                       <div className='flex items-center gap-2 min-w-0 flex-1'>
//                         <Users className='w-4 h-4 text-muted-foreground flex-shrink-0' />
//                         <div className='min-w-0 flex-1'>
//                           <div className='text-sm font-medium text-foreground truncate'>
//                             {group.name}
//                           </div>
//                           <div className='flex items-center gap-2'>
//                             {group.alias && (
//                               <span className='text-xs text-muted-foreground'>@{group.alias}</span>
//                             )}
//                           </div>
//                         </div>
//                       </div>
//                     </button>
//                   ))}
//                 </div>
//               </div>
//             ) : (
//               <div className='p-4 text-center text-sm text-muted-foreground'>
//                 {searchQuery.trim()
//                   ? `No groups found matching "${searchQuery}"`
//                   : 'All groups have been selected'}
//               </div>
//             )}
//           </div>

//           {/* Footer */}
//           {hasSelection && (
//             <div className='p-2 border-t border-gray-100'>
//               <button
//                 onClick={handleClear}
//                 className='w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1'
//               >
//                 Clear all selected groups
//               </button>
//             </div>
//           )}
//         </div>
//       )}
//     </div>
//   );
// };
