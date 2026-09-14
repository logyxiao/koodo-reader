import { RouteComponentProps } from "react-router-dom";

export interface SortShelfDialogProps extends RouteComponentProps<any> {
  handleSortShelfDialog: (isOpenSortShelfDialog: boolean) => void;
  t: (title: string) => string;
  handleShelf: (shelfTitle: string) => void;
  handleMode: (mode: string) => void;
  shelfTitle: string;
}
export interface SortShelfDialogState {
  sortedShelfList: any[];
  currentEditShelf: string;
  currentDeleteShelf: string;
  newShelfName: string;
  newShelfParent: string;
  isOpenDelete: boolean;
}
