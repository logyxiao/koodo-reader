import React from "react";
import "./sortShelfDialog.css";
import { Trans } from "react-i18next";
import { SortShelfDialogProps, SortShelfDialogState } from "./interface";
import ShelfUtil, {
  buildShelfTree,
  inShelfTree,
  shelfName,
  shelfParent,
} from "../../../utils/reader/shelfUtil";
import { ReactSortable } from "react-sortablejs";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import toast from "react-hot-toast";
import DeletePopup from "../deletePopup";
class SortShelfDialog extends React.Component<
  SortShelfDialogProps,
  SortShelfDialogState
> {
  private newShelfInput = React.createRef<HTMLInputElement>();
  constructor(props: SortShelfDialogProps) {
    super(props);
    this.state = {
      sortedShelfList: [],
      currentEditShelf: "",
      currentDeleteShelf: "",
      newShelfName: "",
      newShelfParent: "",
      isOpenDelete: false,
    };
  }
  loadShelves = () => {
    this.setState({
      sortedShelfList: ShelfUtil.getTree().map((node) => ({
        ...node,
        name: node.key,
        id: node.key,
      })),
    });
  };
  componentDidMount(): void {
    this.loadShelves();
  }
  handleClose = () => {
    this.props.handleSortShelfDialog(false);
  };
  handleRenameShelf = () => {
    try {
      const oldKey = this.state.currentEditShelf;
      const nextKey = ShelfUtil.relocate(
        oldKey,
        this.state.newShelfName,
        this.state.newShelfParent
      );
      if (this.props.shelfTitle && inShelfTree(this.props.shelfTitle, oldKey)) {
        this.props.handleShelf(
          nextKey + this.props.shelfTitle.slice(oldKey.length)
        );
      }
      this.loadShelves();
      toast.success(this.props.t("Saved successfully"));
      this.setState({ currentEditShelf: "", newShelfName: "" });
    } catch (error) {
      toast.error(this.props.t((error as Error).message));
    }
  };
  handleDeleteShelf = () => {
    if (!this.state.currentDeleteShelf) return;
    ShelfUtil.removeTree(this.state.currentDeleteShelf);
    if (
      this.props.shelfTitle &&
      inShelfTree(this.props.shelfTitle, this.state.currentDeleteShelf)
    ) {
      this.props.handleShelf("");
      this.props.handleMode("home");
      this.props.history.push("/manager/home");
    }
    this.loadShelves();
  };
  handleDeletePopup = (isOpenDelete: boolean) => {
    this.setState({ isOpenDelete });
  };
  render() {
    const deletePopupProps = {
      mode: "shelf",
      name: this.state.currentDeleteShelf,
      title: "Delete this shelf",
      description:
        "Remove this shelf and all child shelves. Books remain in the library.",
      handleDeletePopup: this.handleDeletePopup,
      handleDeleteOpearion: this.handleDeleteShelf,
    };
    return (
      <div
        className="backup-page-container"
        style={{ height: "450px", top: "calc(50% - 225px)" }}
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {this.state.isOpenDelete && (
          <DeletePopup {...(deletePopupProps as any)} />
        )}
        <div className="backup-dialog-title">
          <Trans>Manage shelf</Trans>
        </div>
        <div className="import-dialog-option">
          {
            <ReactSortable
              list={this.state.sortedShelfList}
              setList={(newState) =>
                this.setState({ sortedShelfList: newState })
              }
              animation={200}
              delayOnTouchOnly={true}
              delay={2}
              scroll={true} // Enable auto-scrolling
              scrollSensitivity={140} // Distance from edge that triggers scrolling (px)
              scrollSpeed={20} // Scrolling speed
              bubbleScroll={true}
              filter={"input,select"}
              preventOnFilter={false}
              onEnd={() => {
                let sortedShelfList = this.state.sortedShelfList.map(
                  (item) => item.name
                );
                ConfigService.setAllListConfig(
                  buildShelfTree(ShelfUtil.getAll(), sortedShelfList).map(
                    (node) => node.key
                  ),
                  "sortedShelfList"
                );
                ShelfUtil.notify();
                this.loadShelves();
              }}
            >
              {this.state.sortedShelfList.map((item) => {
                return this.state.currentEditShelf === item.name ? (
                  <div
                    className="cloud-drive-item shelf-edit-row"
                    key={item.id}
                  >
                    <input
                      ref={this.newShelfInput}
                      type="text"
                      name="newShelf"
                      id="sidebar-new-shelf"
                      style={{ margin: "0px", height: "25px" }}
                      className="tag-list-item-new"
                      value={this.state.newShelfName}
                      aria-label={this.props.t("Shelf name")}
                      onChange={(event) => {
                        const sanitizedValue = event.target.value.replace(
                          /[\[\]{}",:\/\\|<>*?]/g,
                          ""
                        );
                        this.setState({ newShelfName: sanitizedValue });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          this.handleRenameShelf();
                        }
                      }}
                    />
                    <select
                      aria-label={this.props.t("Parent shelf")}
                      value={this.state.newShelfParent}
                      onChange={(event) =>
                        this.setState({ newShelfParent: event.target.value })
                      }
                    >
                      <option value="">{this.props.t("Top level")}</option>
                      {ShelfUtil.getTree()
                        .filter(
                          (node) =>
                            !inShelfTree(node.key, this.state.currentEditShelf)
                        )
                        .map((node) => (
                          <option key={node.key} value={node.key}>
                            {node.key}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      aria-label={this.props.t("Save shelf")}
                      className="shelf-action icon-check"
                      onClick={async () => {
                        this.handleRenameShelf();
                      }}
                      style={{ fontSize: "20px", marginRight: "15px" }}
                    ></button>
                  </div>
                ) : (
                  <div
                    key={item.id}
                    className={`cloud-drive-item `}
                    onClick={() => {}}
                  >
                    <span
                      className="sort-shelf-label"
                      title={item.name}
                      style={{ paddingLeft: item.depth * 16 }}
                    >
                      {shelfName(item.name)}
                    </span>
                    <button
                      type="button"
                      aria-label={
                        this.props.t("Delete shelf") + ": " + item.name
                      }
                      className="shelf-action icon-trash-line "
                      onClick={async () => {
                        this.setState({
                          currentDeleteShelf: item.name,
                        });
                        this.handleDeletePopup(true);
                      }}
                      style={{ fontSize: "20px", marginRight: "15px" }}
                    ></button>
                    <button
                      type="button"
                      aria-label={this.props.t("Edit shelf") + ": " + item.name}
                      className="shelf-action icon-edit-line "
                      onClick={async () => {
                        this.setState({
                          currentEditShelf: item.name,
                          newShelfName: shelfName(item.name),
                          newShelfParent: shelfParent(item.name),
                        });
                        setTimeout(() => {
                          this.newShelfInput.current?.focus();
                        }, 10);
                      }}
                      style={{ fontSize: "20px", marginRight: "15px" }}
                    ></button>
                    <span
                      className="icon-menu "
                      style={{ marginRight: "10px" }}
                    ></span>
                  </div>
                );
              })}
            </ReactSortable>
          }
        </div>
        <div className="import-dialog-back-button">
          {this.props.t(
            "Drag to sort siblings. Edit to change the parent shelf."
          )}
        </div>

        <div
          className="backup-page-close-icon"
          onClick={() => {
            this.handleClose();
          }}
        >
          <span className="icon-close backup-close-icon"></span>
        </div>
      </div>
    );
  }
}

export default SortShelfDialog;
